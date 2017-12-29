//---------------------------
// Query Class
//
// Encodes a query in a form that can be evaluated easily 
//---------------------------

//object constructer
var RqlQuery = function (name) {
    this.name = name || "and";
    this.args = [];
    this.knownOperators = ["sort", "in", "not", "any", "all", "or", "and", "select", "exclude", "values", "limit", "distinct", "recurse", "aggregate", "between", "sum", "mean", "max", "min", "count", "first", "one", "eq", "ne", "le", "ge", "lt", "gt"];
    this.knownScalarOperators = ["mean", "sum", "min", "max", "count", "first", "one"];
    this.arrayMethods = ["forEach", "reduce", "map", "filter", "indexOf", "some", "every"];
    this.parser = new RqlParser();
};

//when function
//TODO may need to adopt the promised-io libary.  Would hope not; in our usage everything should be synchronous
RqlQuery.prototype.when = function (value, callback) {
    callback(value);
};

//serializeArgs function
RqlQuery.prototype.serializeArgs = function serializeArgs(array, delimiter) {
    var results = [];
    for (var i = 0, l = array.length; i < l; i++) {
        results.push(this.queryToString(array[i]));
    }
    return results.join(delimiter);
};

//toString function
RqlQuery.prototype.toString = function () {
    return this.name === "and" ?
		this.serializeArgs(this.args, "&") :
		this.queryToString(this);
};

//queryToString function
RqlQuery.prototype.queryToString = function (part) {
    if (part instanceof Array) {
        return '(' + this.serializeArgs(part, ",") + ')';
    }
    if (part && part.name && part.args) {
        return [
                part.name,
                "(",
                this.serializeArgs(part.args, ","),
                ")"
        ].join("");
    }
    return this.encodeValue(part);
};

//encodeString function
RqlQuery.prototype.encodeString = function (s) {
    if (typeof s === "string") {
        s = encodeURIComponent(s);
        if (s.match(/[\(\)]/)) {
            s = s.replace("(", "%28").replace(")", "%29");
        };
    }
    return s;
};

//encodeValue function
RqlQuery.prototype.encodeValue = function (val) {
    var encoded;
    if (val === null) { val = 'null'; }
    if (val !== this.parser.converters["default"]('' + (val.toISOString && val.toISOString() || val.toString()))) {
        var type = typeof val;
        if (val instanceof RegExp) {
            // TODO: control whether to we want simpler glob() style
            val = val.toString();
            var i = val.lastIndexOf('/');
            type = val.substring(i).indexOf('i') >= 0 ? "re" : "RE";
            val = this.encodeString(val.substring(1, i));
            encoded = true;
        }
        if (type === "object") {
            type = "epoch";
            val = val.getTime();
            encoded = true;
        }
        if (type === "string") {
            val = this.encodeString(val);
            encoded = true;
        }
        val = [type, val].join(":");
    }
    if (!encoded && typeof val === "string") { val = this.encodeString(val); }
    return val;
};

//updateQueryMethods function
//sets up functions on the RqlQuery object to execute various query-string operators & methods
RqlQuery.prototype.updateQueryMethods = function () {
    var that = this;
    this.knownOperators.forEach(function (name) {
        RqlQuery.prototype[name] = function () {
            var newQuery = new RqlQuery(undefined);
            newQuery.executor = that.executor;
            var newTerm = new RqlQuery(name);
            newTerm.args = Array.prototype.slice.call(arguments);
            newQuery.args = that.args.concat([newTerm]);
            return newQuery;
        };
    });
    this.knownScalarOperators.forEach(function (name) {
        RqlQuery.prototype[name] = function () {
            var newQuery = new RqlQuery(undefined);
            newQuery.executor = that.executor;
            var newTerm = new RqlQuery(name);
            newTerm.args = Array.prototype.slice.call(arguments);
            newQuery.args = that.args.concat([newTerm]);
            return newQuery.executor(newQuery);
        };
    });
    this.arrayMethods.forEach(function (name) {
        RqlQuery.prototype[name] = function () {
            var args = arguments;
            return that.when(that.executor(that), function (results) {
                return results[name].apply(results, args);
            });
        };
    });
};

//walk function
// recursively iterate over query terms calling 'fn' for each term
RqlQuery.prototype.walk = function (fn, options) {
    options = options || {};
    function walk(name, terms) {
        (terms || []).forEach(function (term, i, arr) {
            var args, func;
            term != null ? term : term = {};
            func = term.name;
            args = term.args;
            if (!func || !args) {
                return;
            }
            if (args[0] instanceof RqlQuery) {
                walk.call(this, func, args);
            } else {
                var newTerm = fn.call(this, func, args);
                if (newTerm && newTerm.name && newTerm.args)
                    arr[i] = newTerm;
            }
        });
    }
    walk.call(this, this.name, this.args);
};

//push function
// append a new term
RqlQuery.prototype.push = function (term) {
    this.args.push(term);
    return this;
};

//normalize function
/* disambiguate query */
RqlQuery.prototype.normalize = function (options) {
    options = options || {};
    options.primaryKey = options.primaryKey || 'id';
    options.map = options.map || {};
    var result = {
        original: this,
        sort: [],
        limit: [Infinity, 0, Infinity],
        skip: 0,
        limit: Infinity,
        select: [],
        values: false
    };
    var plusMinus = {
        // [plus, minus]
        sort: [1, -1],
        select: [1, 0]
    };
    function normal(func, args) {
        // cache some parameters
        if (func === 'sort' || func === 'select') {
            result[func] = args;
            var pm = plusMinus[func];
            result[func + 'Arr'] = result[func].map(function (x) {
                if (x instanceof Array) {
                    x = x.join('.');
                }
                var o = {};
                var a = /([-+]*)(.+)/.exec(x);
                o[a[2]] = pm[((a[1].charAt(0) === '-') ? 1 : 0) * 1];
                return o;
            });
            result[func + 'Obj'] = {};
            result[func].forEach(function (x) {
                if (x instanceof Array) x = x.join('.');
                var a = /([-+]*)(.+)/.exec(x);
                result[func + 'Obj'][a[2]] = pm[((a[1].charAt(0) === '-') ? 1 : 0) * 1];
            });
        } else if (func === 'limit') {
            // validate limit() args to be numbers, with sane defaults
            var limit = args;
            result.skip = +limit[1] || 0;
            limit = +limit[0] || 0;
            if (options.hardLimit && limit > options.hardLimit)
                limit = options.hardLimit;
            result.limit = limit;
            result.needCount = true;
        } else if (func === 'values') {
            // N.B. values() just signals we want array of what we select()
            result.values = true;
        } else if (func === 'eq') {
            // cache primary key equality -- useful to distinguish between .get(id) and .query(query)
            var t = typeof args[1];
            //if ((args[0] instanceof Array ? args[0][args[0].length-1] : args[0]) === options.primaryKey && ['string','number'].indexOf(t) >= 0) {
            if (args[0] === options.primaryKey && ['string', 'number'].indexOf(t) >= 0) {
                result.pk = String(args[1]);
            }
        }
    }
    this.walk(normal);
    return result;
};