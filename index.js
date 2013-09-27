var
	_      = require('lodash'),
	events = require('events'),
	redis  = require('redis'),
	util   = require('util')
	;

function RedisAdapter()
{
	events.EventEmitter.call(this);
}
util.inherits(RedisAdapter, events.EventEmitter);

RedisAdapter.prototype.redis       = null;
RedisAdapter.prototype.dbname      = null;
RedisAdapter.prototype.constructor = null;
RedisAdapter.prototype.ephemeral   = false;
RedisAdapter.prototype.options     = null;
RedisAdapter.prototype.attempts    = 0;

RedisAdapter.prototype.configure = function(opts, modelfunc)
{
	this.options = opts;
	this.dbname = opts.dbname || modelfunc.prototype.plural;
	this.constructor = modelfunc;
	this.ephemeral = opts.ephemeral;

	this.connect();
};

RedisAdapter.prototype.connect = function()
{
	this.connectTimeout = null;
	this.redis = redis.createClient(this.options.port, this.options.host);

	this.redis.on('error', this.handleError.bind(this));
	this.redis.once('ready', this.handleReady.bind(this));
};

RedisAdapter.prototype.handleReady = function()
{
	this.emit('log', 'redis @ ' + this.options.host + ':' + this.options.port + ' ready');
	this.attempts = 0;
};

function exponentialBackoff(attempt)
{
	return Math.min(Math.floor(Math.random() * Math.pow(2, attempt) + 10), 10000);
}

RedisAdapter.prototype.handleError = function(err)
{
	if (this.connectTimeout)
		return;
	this.emit('log', 'error caught: ' + err);
	this.attempts++;
	this.redis.removeAllListeners('error');
	this.connectTimeout = setTimeout(this.connect.bind(this), exponentialBackoff(this.attempts));
};

RedisAdapter.prototype.provision = function(callback)
{
	// Nothing to do?
	callback(null);
};

RedisAdapter.prototype.all = function(callback)
{
	if (this.ephemeral)
		return callback(null, []);

	this.redis.smembers(this.idskey(), function(err, ids)
	{
		callback(err, ids);
	});
};

RedisAdapter.prototype.hashKey = function(key)
{
	return this.dbname + ':' + key;
};

RedisAdapter.prototype.attachmentKey = function(key)
{
	return this.dbname + ':' + key + ':attaches';
};

RedisAdapter.prototype.idskey = function()
{
	return this.dbname + ':ids';
};

RedisAdapter.prototype.save = function(object, json, callback)
{
	if (!object.key || !object.key.length)
		throw(new Error('cannot save a document without a key'));

	var payload = RedisAdapter.flatten(json);
	var okey = this.hashKey(object.key);

	var chain = this.redis.multi();

	chain.hmset(okey, payload.body);

	if (!this.ephemeral)
		chain.sadd(this.idskey(), object.key);

	if (Object.keys(payload.attachments).length)
		chain.hmset(this.attachmentKey(object.key), payload.attachments);

	if (this.ephemeral)
	{
		if (_.isNumber(object.ttl) && object.ttl > 0)
			chain.expire(okey, object.ttl);
		else if (_.isNumber(object.expire_at) && object.expire_at > 0)
			chain.expireat(okey, Math.floor(object.expire_at));
	}

	chain.exec(function(err, replies)
	{
		callback(err, replies[0]);
	});
};

RedisAdapter.prototype.update = RedisAdapter.prototype.save;

RedisAdapter.prototype.get = function(key, callback)
{
	var self = this;
	if (Array.isArray(key))
		return this.getBatch(key, callback);

	var chain = this.redis.multi();
	var hkey = this.hashKey(key);

	chain.hgetall(hkey);
	chain.ttl(hkey);

	chain.exec(function(err, jsondocs)
	{
		if (err) return callback(err);

		var item = jsondocs[0];
		if (!item) return callback(null, null);

		var object = self.inflate(item);

		if (self.ephemeral)
		{
			var ttl = jsondocs[1];
			object.ttl = ttl;
			object.expire_at = Math.floor(Date.now() / 1000 + ttl);
		}

		callback(null, object);
	});
};

RedisAdapter.prototype.getBatch = function(keylist, callback)
{
	var self = this;
	var chain = this.redis.multi();
	_.each(keylist, function(item)
	{
		var hkey = self.hashKey(item);
		chain.hgetall(hkey);
		chain.ttl(hkey);
	});

	chain.exec(function(err, jsondocs)
	{
		if (err) return callback(err);
		var results = [];

		for (var i = 0, len = jsondocs.length; i < len--; i += 2)
		{
			var item = jsondocs[i];
			if (!item) continue;

			var object = self.inflate(item);

			if (self.ephemeral)
			{
				var ttl = jsondocs[i + 1];
				object.ttl = ttl;
				object.expire_at = Math.floor(Date.now() / 1000 + ttl);
			}

			results.push(object);
		}

		callback(err, results);
	});

};

RedisAdapter.prototype.merge = function(key, attributes, callback)
{
	this.redis.hmset(this.hashKey(key), RedisAdapter.flatten(attributes).body, callback);
};


RedisAdapter.prototype.remove = function(object, callback)
{
	var chain = this.redis.multi();
	chain.del(this.hashKey(object.key));
	chain.del(this.attachmentKey(object.key));

	if (!this.ephemeral)
		chain.srem(this.idskey(), object.key);

	chain.exec(function(err, replies)
	{
		callback(err, replies[0]);
	});
};

RedisAdapter.prototype.destroyMany = function(objects, callback)
{
	var self = this;
	var ids = _.map(objects, function(obj)
	{
		if (typeof obj === 'string')
			return obj;
		return obj.key;
	});

	var idkey = this.idskey();
	var chain = this.redis.multi();

	if (!this.ephemeral)
		_.each(ids, function(id) { chain.srem(idkey, id); });

	chain.del(_.map(ids, function(key) { return self.hashKey(key); }));
	chain.del(_.map(ids, function(key) { return self.attachmentKey(key); }));

	chain.exec(function(err, replies)
	{
		callback(err);
	});
};

RedisAdapter.prototype.attachment = function(key, name, callback)
{
	this.redis.hget(this.attachmentKey(key), name, function(err, payload)
	{
		if (err) return callback(err);
		if (!payload) return callback(null, null);

		var struct = JSON.parse(payload);
		if (struct && struct.body && _.isObject(struct.body))
			struct.body = new Buffer(struct.body);
		callback(null, struct.body);
	});
};

RedisAdapter.prototype.saveAttachment = function(object, attachment, callback)
{
	this.redis.hset(this.attachmentKey(object.key), attachment.name, JSON.stringify(attachment), callback);
};

RedisAdapter.prototype.removeAttachment = function(object, name, callback)
{
	this.redis.hdel(this.attachmentKey(object.key), name, callback);
};

RedisAdapter.prototype.inflate = function(payload)
{
	if (payload === null)
		return;
	var object = new this.constructor();
	var json = {};
	json._attachments = {};
	var matches;

	var fields = Object.keys(payload).sort();
	for (var i = 0; i < fields.length; i++)
	{
		var field = fields[i];

		try
		{
			json[field] = JSON.parse(payload[field]);
		}
		catch (e)
		{
			json[field] = payload[field];
		}
	}

	object.initFromStorage(json);
	return object;
};

RedisAdapter.flatten = function(json)
{
	var payload = { body: {} };
	var i;

	if (json._attachments)
	{
		payload.attachments = {};
		var attaches = Object.keys(json._attachments);
		for (i = 0; i < attaches.length; i++)
		{
			var attachment = json._attachments[attaches[i]];
			var item =
			{
				body: attachment.body,
				content_type: attachment.content_type,
				length: attachment.length,
				name: attaches[i]
			};
			payload.attachments[item.name] = JSON.stringify(item);
		}
		delete json._attachments;
	}

	var fields = Object.keys(json).sort();
	for (i = 0; i < fields.length; i++)
	{
		var field = fields[i];
		payload.body[field] = JSON.stringify(json[field]);
	}

	return payload;
};

//-----------------------------------------------------------------

module.exports = RedisAdapter;
