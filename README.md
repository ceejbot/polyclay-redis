polyclay-redis
==============

A redis persistence adapter for [Polyclay](https://github.com/ceejbot/polyclay).

[![Build Status](https://secure.travis-ci.org/ceejbot/polyclay-redis.png)](http://travis-ci.org/ceejbot/polyclay-redis) [![Dependencies](https://david-dm.org/ceejbot/polyclay-redis.png)](https://david-dm.org/ceejbot/polyclay-redis) [![NPM version](https://badge.fury.io/js/polyclay-redis.png)](http://badge.fury.io/js/polyclay-redis)



## How-to

For the redis adapter, specify host & port of your redis server. The `dbname` option is used to namespace keys; it defaults to the plural value of the model class. The redis adapter will store models in hash keys of the form *dbname*:*key*. It will also use a set at key <dbname>:ids to track model ids.

```javascript
var polyclay = require('polyclay'),
    RedisAdapter = require('polyclay-redis');

var RedisModelFunc = polyclay.Model.buildClass({
    properties:
    {
        name: 'string',
        description: 'string'
    },
    singular: 'widget',
    plural: 'widgets'
});
polyclay.persist(Widget);


polyclay.persist(RedisModelFunc, 'name');

var options =
{
    host: 'localhost',
    port: 6379
};
RedisModelFunc.setStorage(options, RedisAdapter);
```

The redis client is available at obj.adapter.redis. The db name falls back to the model plural if you don't include it. The dbname is used to namespace model keys.

### Ephemeral data

If you would like your models to persist only for a limited time in redis, set the `ephemeral` field in the options object to true.

```
var options =
{
    host: 'localhost',
    port: 6379,
    ephemeral: true
};
RedisModelFunc.setStorage(options, RedisAdapter);
```

The adapter will *not* track model ids for ephemeral objects, so RedisModelFunc.all() will always respond with an empty list. However, the `save()` function attempts to set a time to live for an object.

If the model has a `ttl` field, the adapter uses that to set the redis TTL on an object when it is updated or saved. 

Similarly, if an object has an `expire_at`, the adapter sets the redis key to EXPIRE_AT the given timestamp.

If you do not set the `ephemeral` option, ttl and expire_at properties will be not be treated specially.
