/*global describe:true, it:true, before:true, after:true */

var
	demand       = require('must'),
	events       = require('events'),
	fs           = require('fs'),
	path         = require('path'),
	polyclay     = require('polyclay'),
	redis        = require('redis'),
	RedisAdapter = require('../index'),
	sinon        = require('sinon'),
	util         = require('util')
	;

var testDir = process.cwd();
if (path.basename(testDir) !== 'test')
	testDir = path.join(testDir, 'test');
var attachmentdata = fs.readFileSync(path.join(testDir, 'test.png'));

describe('redis adapter', function()
{
	var modelDefinition = {
		properties:
		{
			key:           'string',
			name:          'string',
			created:       'date',
			foozles:       'array',
			snozzers:      'hash',
			is_valid:      'boolean',
			count:         'number',
			required_prop: 'string',
			ttl:           'number'
		},
		optional: [ 'computed', 'ephemeral' ],
		required: [ 'name', 'is_valid', 'required_prop'],
		singular: 'model',
		plural: 'models',
		initialize: function()
		{
			this.ran_init = true;
		}
	};

	var Model, instance, another, hookTest, hookid;

	before(function()
	{
		Model = polyclay.Model.buildClass(modelDefinition);
		polyclay.persist(Model);
	});

	it('can be configured for database access', function()
	{
		var options =
		{
			host: 'localhost',
			port: 6379,
		};

		Model.setStorage(options, RedisAdapter);
		Model.adapter.must.exist();
		Model.adapter.redis.must.exist();
		Model.adapter.constructor.must.equal(Model);
		Model.adapter.dbname.must.equal(Model.prototype.plural);
	});

	it('provision does nothing', function(done)
	{
		Model.provision(function(err)
		{
			demand(err).not.exist();
			done();
		});
	});

	it('throws when asked to save a document without a key', function()
	{
		var noID = function()
		{
			var obj = new Model();
			obj.name = 'idless';
			obj.save(function(err, reply)
			{
			});
		};

		noID.must.throw(Error);
	});

	it('can save a document in the db', function(done)
	{
		instance = new Model();
		instance.update({
			key: '1',
			name: 'test',
			created: Date.now(),
			foozles: ['three', 'two', 'one'],
			snozzers: { field: 'value' },
			is_valid: true,
			count: 3,
			required_prop: 'requirement met',
			computed: 17
		});

		instance.save(function(err, reply)
		{
			demand(err).not.exist();
			reply.must.exist();
			done();
		});
	});

	it('can retrieve the saved document', function(done)
	{
		Model.get(instance.key, function(err, retrieved)
		{
			demand(err).not.exist();
			retrieved.must.exist();
			retrieved.must.be.an.object();
			retrieved.key.must.equal(instance.key);
			retrieved.name.must.equal(instance.name);
			retrieved.created.getTime().must.equal(instance.created.getTime());
			retrieved.is_valid.must.equal(instance.is_valid);
			retrieved.count.must.equal(instance.count);
			retrieved.computed.must.equal(instance.computed);
			done();
		});
	});

	it('can update the document', function(done)
	{
		instance.name = "New name";
		instance.isDirty().must.be.true();
		instance.save(function(err, response)
		{
			demand(err).not.exist();
			response.must.be.a.string();
			response.must.equal('OK');
			instance.isDirty().must.equal(false);
			done();
		});
	});


	it('can fetch in batches', function(done)
	{
		var ids = [ instance.key ];
		var obj = new Model();
		obj.name = 'two';
		obj.key = '2';
		obj.save(function(err, response)
		{
			ids.push(obj.key);

			Model.get(ids, function(err, itemlist)
			{
				demand(err).not.exist();
				itemlist.must.be.an.array();
				itemlist.length.must.equal(2);
				done();
			});
		});
	});

	it('the adapter get() can handle an id or an array of ids', function(done)
	{
		var ids = [ '1', '2' ];
		Model.adapter.get(ids, function(err, itemlist)
		{
			demand(err).not.exist();
			itemlist.must.be.an.array();
			itemlist.length.must.equal(2);
			done();
		});
	});

	it('can fetch all', function(done)
	{
		Model.all(function(err, itemlist)
		{
			demand(err).not.exist();
			itemlist.must.be.an.array();
			itemlist.length.must.be.at(2);
			done();
		});
	});

	it('constructMany() retuns an empty list when given empty input', function(done)
	{
		Model.constructMany([], function(err, results)
		{
			demand(err).not.exist();
			results.must.be.an.array();
			results.length.must.equal(0);
			done();
		});
	});

	it('merge() updates properties then saves the object', function(done)
	{
		Model.get('2', function(err, item)
		{
			demand(err).not.exist();

			item.merge({ is_valid: true, count: 1023 }, function(err, response)
			{
				demand(err).not.exist();
				Model.get(item.key, function(err, stored)
				{
					demand(err).not.exist();
					stored.count.must.equal(1023);
					stored.is_valid.must.equal(true);
					stored.name.must.equal(item.name);
					done();
				});
			});
		});
	});

	it('can add an attachment type', function()
	{
		Model.defineAttachment('frogs', 'text/plain');
		Model.defineAttachment('avatar', 'image/png');

		instance.set_frogs.must.be.a.function();
		instance.fetch_frogs.must.be.a.function();
		var property = Object.getOwnPropertyDescriptor(Model.prototype, 'frogs');
		property.get.must.be.a.function();
		property.set.must.be.a.function();
	});

	it('can save attachments', function(done)
	{
		instance.avatar = attachmentdata;
		instance.frogs = 'This is bunch of frogs.';
		instance.isDirty().must.equal.true;
		instance.save(function(err, response)
		{
			demand(err).not.exist();
			instance.isDirty().must.equal.false;
			done();
		});
	});

	it('can retrieve attachments', function(done)
	{
		Model.get(instance.key, function(err, retrieved)
		{
			retrieved.fetch_frogs(function(err, frogs)
			{
				demand(err).not.exist();
				frogs.must.be.a.string();
				frogs.must.equal('This is bunch of frogs.');
				retrieved.fetch_avatar(function(err, imagedata)
				{
					demand(err).not.exist();
					imagedata.must.be.instanceof(Buffer);
					imagedata.length.must.equal(attachmentdata.length);
					done();
				});
			});
		});
	});

	it('can update an attachment', function(done)
	{
		instance.frogs = 'Poison frogs are awesome.';
		instance.save(function(err, response)
		{
			demand(err).not.exist();
			Model.get(instance.key, function(err, retrieved)
			{
				demand(err).not.exist();
				retrieved.fetch_frogs(function(err, frogs)
				{
					demand(err).not.exist();
					frogs.must.equal(instance.frogs);
					retrieved.fetch_avatar(function(err, imagedata)
					{
						demand(err).not.exist();
						imagedata.length.must.equal(attachmentdata.length);
						done();
					});
				});
			});
		});
	});

	it('can store an attachment directly', function(done)
	{
		instance.frogs = 'Poison frogs are awesome, but I think sand frogs are adorable.';
		instance.saveAttachment('frogs', function(err, response)
		{
			demand(err).not.exist();
			Model.get(instance.key, function(err, retrieved)
			{
				demand(err).not.exist();
				retrieved.fetch_frogs(function(err, frogs)
				{
					demand(err).not.exist();
					frogs.must.equal(instance.frogs);
					done();
				});
			});
		});
	});

	it('saveAttachment() clears the dirty bit', function(done)
	{
		instance.frogs = 'This is bunch of frogs.';
		instance.isDirty().must.equal(true);
		instance.saveAttachment('frogs', function(err, response)
		{
			demand(err).not.exist();
			instance.isDirty().must.equal(false);
			done();
		});
	});

	it('can remove an attachment', function(done)
	{
		instance.removeAttachment('frogs', function(err, deleted)
		{
			demand(err).not.exist();
			deleted.must.be.true();
			done();
		});
	});


	it('caches an attachment after it is fetched', function(done)
	{
		instance.avatar = attachmentdata;
		instance.save(function(err, response)
		{
			demand(err).not.exist();
			instance.isDirty().must.be.false();
			instance.fetch_avatar(function(err, imagedata)
			{
				demand(err).not.exist();
				var cached = instance.__attachments['avatar'].body;
				cached.must.exist();
				(cached instanceof Buffer).must.equal(true);
				polyclay.dataLength(cached).must.equal(polyclay.dataLength(attachmentdata));
				done();
			});
		});
	});

	it('can fetch an attachment directly', function(done)
	{
		Model.adapter.attachment('1', 'avatar', function(err, body)
		{
			demand(err).not.exist();
			(body instanceof Buffer).must.equal(true);
			polyclay.dataLength(body).must.equal(polyclay.dataLength(attachmentdata));
			done();
		});
	});

	it('removes an attachment when its data is set to null', function(done)
	{
		instance.avatar = null;
		instance.save(function(err, response)
		{
			demand(err).not.exist();
			Model.get(instance.key, function(err, retrieved)
			{
				demand(err).not.exist();
				retrieved.fetch_avatar(function(err, imagedata)
				{
					demand(err).not.exist();
					demand(imagedata).not.exist();
					done();
				});
			});
		});
	});

	it('can remove a document from the db', function(done)
	{
		instance.destroy(function(err, deleted)
		{
			demand(err).not.exist();
			deleted.must.exist();
			instance.destroyed.must.be.true();
			done();
		});
	});

	it('can remove documents in batches', function(done)
	{
		var obj2 = new Model();
		obj2.key = '4';
		obj2.name = 'two';
		obj2.save(function(err, response)
		{
			Model.get('2', function(err, obj)
			{
				demand(err).not.exist();
				obj.must.be.an.object();

				var itemlist = [obj, obj2.key];
				Model.destroyMany(itemlist, function(err, response)
				{
					demand(err).not.exist();
					// TODO examine response more carefully
					done();
				});
			});
		});
	});

	it('destroyMany() does nothing when given empty input', function(done)
	{
		Model.destroyMany(null, function(err)
		{
			demand(err).not.exist();
			done();
		});
	});

	it('destroy responds with an error when passed an object without an id', function(done)
	{
		var obj = new Model();
		obj.destroy(function(err, destroyed)
		{
			err.must.be.an.object();
			err.message.must.equal('cannot destroy object without an id');
			done();
		});
	});

	it('destroy responds with an error when passed an object that has already been destroyed', function(done)
	{
		var obj = new Model();
		obj.key = 'foozle';
		obj.destroyed = true;
		obj.destroy(function(err, destroyed)
		{
			err.must.be.an.object();
			err.message.must.equal('object already destroyed');
			done();
		});
	});

	it('removes attachments when removing an object', function(done)
	{
		var obj = new Model();
		obj.key = 'cats';
		obj.frogs = 'Cats do not eat frogs.';
		obj.name = 'all about cats';

		obj.save(function(err, reply)
		{
			demand(err).not.exist();
			reply.must.equal('OK');

			obj.destroy(function(err, destroyed)
			{
				demand(err).not.exist();
				var k = Model.adapter.attachmentKey('cats');
				Model.adapter.redis.hkeys(k, function(err, reply)
				{
					demand(err).not.exist();
					reply.must.be.an.array();
					reply.length.must.equal(0);
					done();
				});
			});
		});
	});

	it('inflate() handles bad json by assigning properties directly', function()
	{
		var bad =
		{
			name: 'this is not valid json'
		};
		var result = Model.adapter.inflate(bad);
		result.name.must.equal(bad.name);
	});

	it('inflate() does not construct an object when given a null payload', function()
	{
		var result = Model.adapter.inflate(null);
		demand(result).be.undefined();
	});

	it('listens for redis connection errors', function(done)
	{
		Model.adapter.on('log', function(msg)
		{
			if (msg.match(/ready/))
			{
				Model.adapter.removeAllListeners('log');
				done();
			}
		});

		Model.adapter.redis.emit('error', new Error('wat'));
	});

	it('attempts to reconnect until redis is available again', function(done)
	{
		var count = 0;
		function notARedis(port, host)
		{
			if (++count > 3)
			{
				stub.restore();
				return redis.createClient(port, host);
			}

			var obj = new events.EventEmitter();
			setTimeout(function() { obj.emit('error', new Error('ECONNREFUSED fake')); }, 200);
			return obj;
		}

		var stub = sinon.stub(redis, 'createClient', notARedis);

		function handleLog(msg)
		{
			if (msg.match(/ready/))
			{
				stub.restore();
				Model.adapter.removeAllListeners('log');
				done();
			}
		}

		Model.adapter.on('log', handleLog);
		Model.adapter.redis.emit('error', new Error('wat'));
	});

	after(function(done)
	{
		Model.adapter.redis.del(Model.adapter.idskey(), function(err, deleted)
		{
			demand(err).not.exist();
			done();
		});
	});
});

describe('ephemeral models', function()
{
	var ephemeralDef =
	{
		properties:
		{
			key:           'string',
			name:          'string',
		},
		required: [ 'name', ],
		singular: 'ephemeral',
		plural: 'ephemera',
		initialize: function()
		{
			this.ran_init = true;
		}
	};

	var Ephemeral;

	before(function()
	{
		Ephemeral = polyclay.Model.buildClass(ephemeralDef);
		polyclay.persist(Ephemeral);
		var options =
		{
			host:     'localhost',
			port:     6379,
			ephemeral: true
		};
		Ephemeral.setStorage(options, RedisAdapter);
	});

	it('setting the ttl field on an object sets its time to live in redis', function(done)
	{
		var obj = new Ephemeral();
		obj.key = 'mayfly';
		obj.name = 'George';

		obj.ttl = 2;
		obj.save(function(err, reply)
		{
			demand(err).not.exist();
			reply.must.equal('OK');
			var okey = Ephemeral.adapter.hashKey(obj.key);

			Ephemeral.adapter.redis.ttl(okey, function(err, response)
			{
				demand(err).not.exist();
				var ttl = parseInt(response, 10);
				ttl.must.be.a.number();
				ttl.must.be.below(4);

				setTimeout(function()
				{
					Ephemeral.adapter.redis.exists(okey, function(err, exists)
					{
						demand(err).not.exist();
						exists.must.equal(0);
						done();
					});
				}, ttl * 1000 + 100);
			});
		});
	});

	it('setting the expire_at field on an object sets its time to live in redis', function(done)
	{
		var obj = new Ephemeral();
		obj.key = 'mayfly2';
		obj.name = 'Fred';

		var expireAt = Date.now()/1000 + 2;
		obj.expire_at = expireAt;
		obj.save(function(err, reply)
		{
			demand(err).not.exist();
			reply.must.equal('OK');

			Ephemeral.get(obj.key, function(err, model)
			{
				demand(err).not.exist();

				model.must.have.property('ttl');
				model.must.have.property('expire_at');

				var ttl = model.ttl;
				ttl.must.be.a.number();
				ttl.must.be.below(3);

				model.expire_at.must.be.a.number();
				model.expire_at.must.be.at.most(expireAt);

				setTimeout(function()
				{
					var okey = Ephemeral.adapter.hashKey(model.key);
					Ephemeral.adapter.redis.exists(okey, function(err, exists)
					{
						demand(err).not.exist();
						exists.must.equal(0);
						done();
					});
				}, ttl * 1000 + 500);
			});
		});
	});

	it('updating an object with a ttl preserves the ttl', function(done)
	{
		var obj = new Ephemeral();
		obj.key = 'mayfly2';
		obj.name = 'Fred';

		var start = Date.now();
		var expires = start + 5000;

		obj.expire_at = expires/1000;

		obj.save(function(err, reply)
		{
			demand(err).not.exist();
			reply.must.equal('OK');

			Ephemeral.get(obj.key, function(err, obj)
			{
				demand(err).not.exist();
				obj.expire_at.must.be.below(expires / 1000 + 1);

				obj.name = 'weasel';
				obj.save(function(err, reply)
				{
					demand(err).not.exist();
					var okey = Ephemeral.adapter.hashKey(obj.key);

					Ephemeral.adapter.redis.ttl(okey, function(err, timeleft)
					{
						demand(err).not.exist();
						(+timeleft).must.be.below(obj.ttl + 1);
						done();
					});
				});
			});
		});
	});
});
