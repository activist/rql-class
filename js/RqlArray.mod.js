//---------------------------
// Array Class
//
// contains implementation of array-based query functions, and converts a query object into 
// javascript that can be applied on an array of data
//---------------------------

import RqlParser from './RqlParser.mod.js';
import RqlQuery from './RqlQuery.mod.js';

export default class RqlArray {

    //object constructer
    constructor () {
        var that = this;

        //this.parseQuery = new RqlParser();
        this.nextId = 1;
        this.jsOperatorMap = {
            "eq": "===",
            "ne": "!==",
            "le": "<=",
            "ge": ">=",
            "lt": "<",
            "gt": ">"
        };

        //big set of operator functions
        //inside all operator functions, 'this' refers to the array of data that has been passed in to RqlArray.executeQuery
        // TODO will need to change the THIS properties here
        this.operators = {
            //will sort an array based on a property value. a leading plus or minus will dictate the direction of the sort
            // e.g. sort(+lastName)
            //can be applied after a filter
            // e.g. lt(age,40),sort(-age)
            sort: function () {
                var terms = [];
                for (var i = 0; i < arguments.length; i++) {
                    var sortAttribute = arguments[i];
                    var firstChar = sortAttribute.charAt(0);
                    var term = { attribute: sortAttribute, ascending: true };
                    if (firstChar == "-" || firstChar == "+") {
                        if (firstChar == "-") {
                            term.ascending = false;
                        }
                        term.attribute = term.attribute.substring(1);
                    }
                    terms.push(term);
                }
                //sort the array of data
                this.sort(function (a, b) {
                    for (var term, i = 0; term = terms[i]; i++) {
                        if (a[term.attribute] != b[term.attribute]) {
                            return term.ascending == a[term.attribute] > b[term.attribute] ? 1 : -1;
                        }
                    }
                    return 0;
                });
                return this;
            },
            //will return true if a property value matches a regex pattern with case insensitivity
            // e.g. match(firstName,bi)
            match: that.filter(function (value, regex) {            
                return new RegExp(regex, 'i').test(value);
            }),
            //will return true if a property value matches a regex pattern with case sensitivity
            // e.g. matchcase(firstName,Bi)
            matchcase: that.filter(function (value, regex) {
                return new RegExp(regex).test(value);
            }),
            //will return true if a property has a value matching any value in the second parameter (which is an array of values).
            //essentially a shortcut for a string of equality checks separated by ORs
            // e.g. in(firstName,(John,Johnny,Jon))
            "in": that.filter(function (value, values) {
                return that.contains(values, value);
            }),
            //will return true if a property has a value not matching any value in the second parameter (which is an array of values).
            //essentially a shortcut for a string of equality checks separated by ORs, then negated
            // e.g. out(firstName,(Jimbo,Danbo,Hankbo))
            out: that.filter(function (value, values) {
                return !that.contains(values, value);
            }),
            //used for inspecting array properties, will return true if array has a value in it
            // e.g. contains(colours,blue)
            //where colours is an array property of the data objects e.g. [{colours:['green', 'red']},{colours:['green', 'blue']}]
            //the value can also be a function that applies a filter to elements of the array.
            // e.g. contains(paints,eq(colour,blue))
            //where the source data could be [{paints:[{size:1, colour:'blue'}, {size:8, colour:'green'}]}, {paints:[{size:3, colour:'red'}]}]
            contains: that.filter(function (array, value) {
                if (typeof value == "function") {
                    return array instanceof Array && that.each(array, function (v) {
                        return value.call([v]).length;
                    });
                }
                else {
                    return array instanceof Array && that.contains(array, value);
                }
            }),
            //used for inspecting array properties, will return true if array does not have a value in it
            // e.g. excludes(colours,blue)
            //where colours is an array property of the data objects e.g. [{colours:['green', 'red']}, {colours:['green', 'blue']}]
            excludes: that.filter(function (array, value) {
                if (typeof value == "function") {
                    return !that.each(array, function (v) {
                        return value.call([v]).length;
                    });
                }
                else {
                    return !that.contains(array, value);
                }
            }),
            //will apply OR logic to any number of conditions
            //e.g. or(eq(firstName,John),eq(firstName,Johnny),eq(firstName,Jon))
            or: function () {

            
                var items = [];
                var idProperty = "__rqlId" + that.nextId++;
                try {
                    for (var i = 0; i < arguments.length; i++) {
                        //apply each 'or' test against the data
                        var group = arguments[i].call(this);
                        for (var j = 0, l = group.length; j < l; j++) {
                            var item = group[j];
                            // use marker to do a union in linear time.
                            if (!item[idProperty]) {
                                item[idProperty] = true;
                                items.push(item);
                            }
                        }
                    }
                } finally {
                    // cleanup markers
                    //TODO figure out what this code is doing?
                    for (var i = 0, l = items.length; i < l; i++) {
                        //JR - orig version did not target the index.  confirmed problem existed in original dojo version 
                        //delete items[idProperty];
                        delete items[i][idProperty];
                    }
                }
                return items;
                
                
                //alternate version taken from http://rql-engine.eu01.aws.af.cm/
                /*
                var items = [];
                //TODO: remove duplicates and use condition property
                for ( var i = 0; i < arguments.length; i++) {
                    items = items.concat(arguments[i].call(this));
                }
                return items;
                */
                
            },
            //will apply AND logic to any number of conditions
            //e.g. and(lt(age,50),eq(firstName,Jake),eq(lastName,Chambers))
            and: function () {
                var items = this; //the array of data
                // TODO: use condition property
                for (var i = 0; i < arguments.length; i++) {
                    items = arguments[i].call(items);
                }
                return items;
            },
            //will return objects with only the given properties
            //e.g. select(firstName,lastName)
            //when applied on an array of "person" objects with many properties, will return array of objects with only firstName and lastName properties
            select: function () {
                var args = arguments;
                var argc = arguments.length;
                return that.each(this, function (object, emit) {
                    var selected = {};
                    for (var i = 0; i < argc; i++) {
                        var propertyName = args[i];
                        var value = that.evaluateProperty(object, propertyName);
                        if (typeof value != "undefined") {
                            selected[propertyName] = value;
                        }
                    }
                    emit(selected);
                });
            },
            //will return objects with the given properties removed
            //e.g. unselect(firstName,lastName)
            //when applied on an array of "person" objects with many properties, will return array of objects with firstName and lastName properties removed
            unselect: function () {
                var args = arguments;
                var argc = arguments.length;
                return that.each(this, function (object, emit) {
                    var selected = {};
                    for (var i in object) if (object.hasOwnProperty(i)) {
                        selected[i] = object[i];
                    }
                    for (var i = 0; i < argc; i++) {
                        delete selected[args[i]];
                    }
                    emit(selected);
                });
            },
            //will return an array of values for a given property.  if multiple properties are given, will return arrays of values for each data item
            // e.g. values(firstName)
            // could return ['Roland','Susannah','Eddie']
            // e.g. values(firstName,lastName)
            // could return [['Roland','Deschain'],['Susannah','Dean'],['Eddie','Dean']]
            values: function (first) {
                if (arguments.length == 1) {
                    return that.each(this, function (object, emit) {
                        emit(object[first]);
                    });
                }
                var args = arguments;
                var argc = arguments.length;
                return that.each(this, function (object, emit) {
                    var selected = [];
                    if (argc === 0) {
                        for (var i in object) if (object.hasOwnProperty(i)) {
                            selected.push(object[i]);
                        }
                    } else {
                        for (var i = 0; i < argc; i++) {
                            var propertyName = args[i];
                            selected.push(object[propertyName]);
                        }
                    }
                    emit(selected);
                });
            },
            //will return a subsection of the data array.  first parameter is number of items to return. second parameter is index to start taking at.
            //unclear what third parameter 'maxCount' does. it adds extra properties to the result, but nothing seems to use them
            // e.g. limit(10,4)
            // will return array obects 5 through 14
            limit: function (limit, start, maxCount) {
                var totalCount = this.length;
                start = start || 0;
                var sliced = this.slice(start, start + limit);
                if (maxCount) {
                    sliced.start = start;
                    sliced.end = start + sliced.length - 1;
                    sliced.totalCount = Math.min(totalCount, typeof maxCount === "number" ? maxCount : Infinity);
                }
                return sliced;
            },
            //returns the array of values with any duplicates removed
            //does not appear to work on complex objects
            // e.g. distinct()
            //can come after a filter
            // e.g. values(lastName),distinct()
            distinct: function () {
                var primitives = {};
                var needCleaning = [];
                var newResults = this.filter(function (value) {
                    if (value && typeof value == "object") {
                        if (!value.__found__) {
                            value.__found__ = function () { };// get ignored by JSON serialization
                            needCleaning.push(value);
                            return true;
                        }
                    } else {
                        if (!primitives[value]) {
                            primitives[value] = true;
                            return true;
                        }
                    }
                });
                that.each(needCleaning, function (object) {
                    delete object.__found__;
                });
                return newResults;
            },        
            //flattens out nested arrays
            // e.g. input [[1,2,3],[[4,5],[6,7]]]   will return  [1,2,3,4,5,6,7]
            //will also extract and flatten any arrays that are found under the given property
            // e.g. input  [{"name":"Roland", "orders":[{"id": 25}, {"id":40}]}, {"name":"Jake", "orders":[{"id": 19}]}] 
            //      query  recurse(orders)    
            //      result [{"name":"Roland", "orders":[{"id": 25}, {"id":40}]}, {"id": 25}, {"id":40}, {"name":"Jake", "orders":[{"id": 19}]}, {"id": 19}]   
            recurse: function (property) {
                // TODO: this needs to use lazy-array
                var newResults = [];          
                function recurse(value) {
                    if (value instanceof Array) {
                        that.each(value, recurse);
                    } else {
                        newResults.push(value);
                        if (property) {
                            value = value[property];
                            if (value && typeof value == "object") {
                                recurse(value);
                            }
                        } else {
                            for (var i in value) {
                                if (value[i] && typeof value[i] == "object") {
                                    recurse(value[i]);
                                }
                            }
                        }
                    }
                }
                recurse(this);
                return newResults;
            },
            //returns aggregations on the array.
            //parameters are list of values to group by, and list of functions to aggregate over the data.
            //functions should be appropriate.  i.e. they are applied against an array and return a scalar.
            //good functions: sum, count, first, max, min, mean 
            // e.g. aggregate(age,mean(salary))
            // e.g. aggregate(age,gender,mean(salary),count())
            //aggregation results are stored in numerically named properties in order of how they are defined in the function.
            // e.g. aggregate(age,mean(salary),count())
            //   could return something like [{"age":20, "0":53216, "1":13},{"age":21, "0":55898, "1":11},...]
            //can come after a filter
            // e.g. lt(age,50),aggregate(age,mean(salary))
            aggregate: function () {
                var distinctives = [];
                var aggregates = [];
                //figure out the parameters. functions are for aggregatin'. values are for grouping
                for (var i = 0; i < arguments.length; i++) {
                    var arg = arguments[i];
                    if (typeof arg === "function") {
                        aggregates.push(arg);
                    } else {
                        distinctives.push(arg);
                    }
                }
                var distinctObjects = {};
                var dl = distinctives.length;
                //go through all array objects and group thing together based on values of grouping properties
                that.each(this, function (object) {
                    var key = "";
                    for (var i = 0; i < dl; i++) {
                        key += '/' + object[distinctives[i]];
                    }
                    var arrayForKey = distinctObjects[key];
                    if (!arrayForKey) {
                        arrayForKey = distinctObjects[key] = [];
                    }
                    arrayForKey.push(object);
                });
                var al = aggregates.length;
                var newResults = [];
                //call the aggregation functions on each unique grouping.
                //put all the function results (and grouping values) into result objects
                for (var key in distinctObjects) {
                    var arrayForKey = distinctObjects[key];
                    var newObject = {};
                    for (var i = 0; i < dl; i++) {
                        var property = distinctives[i];
                        newObject[property] = arrayForKey[0][property];
                    }
                    for (var i = 0; i < al; i++) {
                        var aggregate = aggregates[i];
                        newObject[i] = aggregate.call(arrayForKey);
                    }
                    newResults.push(newObject);
                }
                return newResults;
            },
            //returns elements that are between a range. range can be of different types (though object type gets a little wonky)
            // e.g. between(age,(20,30))
            // e.g. between(lastName,(Ma,Mo))
            // e.g. between(,(100,200))   <-- works for array of values e.g. [100,200,300,400]
            between: that.filter(function (value, range) {
                return value >= range[0] && value < range[1];
            }),        
            //returns the sum of the value in the array, or in a property of the array
            //value used must be numeric
            // e.g. sum()    <-- only works for array of numerics e.g. [1,2,3,4]
            // e.g. sum(age)
            //can come after a filter
            // e.g. gt(age,20),sum(age)
            sum: that.reducer(function (a, b) {
                //adds up array using reducer, which applies a+b along each array element
                return a + b;
            }),
            //returns the mean average value in the array, or in a property of the array
            //value used must be numeric
            // e.g. mean()    <-- only works for array of numerics e.g. [1,2,3,4]
            // e.g. mean(age)
            //can come after a filter
            // e.g. gt(age,20),mean(age)
            mean: function (property) {
                return that.operators.sum.call(this, property) / this.length;
            },
            //returns the maximum value in the array, or in a property of the array
            //value used must be numeric
            // e.g. max()    <-- only works for array of numerics e.g. [1,2,3,4]
            // e.g. max(age)
            //can come after a filter
            // e.g. lt(age,65),max(age)
            max: that.reducer(function (a, b) {
                return Math.max(a, b);
            }),
            //returns the minimum value in the array, or in a property of the array
            //value used must be numeric
            // e.g. min()    <-- only works for array of numerics e.g. [1,2,3,4]
            // e.g. min(age)
            //can come after a filter
            // e.g. gt(age,20),min(age)
            min: that.reducer(function (a, b) {
                return Math.min(a, b);
            }),
            //returns the number of elements in the data array
            //important to note the result is not contained in an array.
            // e.g. count()
            // e.g. input ["hello", "goodbye"] , result will be 2, not [2]      
            //can come after a filter
            // e.g. eq(lastName,Dean),count()  
            count: function () {
                return this.length;
            },
            //returns the first element of the data array
            //important to note the result is not contained in an array.
            // e.g. first()
            // e.g. input ["hello", "goodbye"] , result will be "hello", not ["hello"]      
            //can come after a filter
            // e.g. values(lastName),first()  
            first: function () {
                return this[0];
            },
            //returns the only element of the data array, or an error if more than one
            //important to note the result is not contained in an array.
            // e.g. one()
            // e.g. input ["hello"] , result will be "hello", not ["hello"]      
            //can come after a filter
            // e.g. values(lastName),one()  
            one: function () {
                if (this.length > 1) {
                    throw new TypeError("More than one object found");
                }
                return this[0];
            }
        };
    }

    //each function
    //applies callback on all items of an array.  callback functions pass results back using an emit function
    each (array, callback) {
        var emit, result;
        if (callback.length > 1) {
            // can take a second param, emit
            result = [];
            emit = function (value) {
                result.push(value);
            }
        }
        for (var i = 0, l = array.length; i < l; i++) {
            if (callback(array[i], emit)) {
                return result || true;
            }
        }
        return result;
    }

    //contains function
    contains (array, item) {
        for (var i = 0, l = array.length; i < l; i++) {
            if (array[i] === item) {
                return true;
            }
        }
    }

    //stringify	 function
    //use JSON object function if it is defined.  else use custom function
    stringify (str) {
        return JSON.stringify(str);
    }

    /*
    } = typeof JSON !== "undefined" && JSON.stringify || function (str) {
        return '"' + str.replace(/"/g, "\\\"") + '"';
    };

    */

    //filter function
    //filters out any array items that do not satisfy the condition function

    //     may need to add an array parameter, as 'this' may get jibbed now that its part of the prototype.
    //     as originally written, 'this' would refer to the data array being filtered
    //     update: seems to be working.  i think the 'this' inside the inner function is not affected by the prototype.  the 'this' outside is. 
    filter (condition, not) {
        var that = this;
        // convert to boolean right now
        var filter = function (property, second) {
            if (typeof second == "undefined") {
                second = property;
                property = undefined;
            }
            var args = arguments;
            var filtered = [];
            for (var i = 0, length = this.length; i < length; i++) {
                var item = this[i];
                if (condition(that.evaluateProperty(item, property), second)) {
                    filtered.push(item);
                }
            }
            return filtered;
        };
        //crazy trickery here. mash in the condition function as a property to the filter function, and filter will use it when it runs.
        filter.condition = condition;
        return filter;
    }

    //reducer function
    //applies a function to an array that crawls over each element of the array and ends up producing a single value
    //e.g. summing up numbers
    //    may need to trick in the data as the prototype will mess up 'this'
    //    nope. same reason as above
    reducer (func) {
        return function (property) {
            var result = this[0];
            if (property) {
                //apply the reducer function along the array, using the value of the given property
                result = result && result[property];
                for (var i = 1, l = this.length; i < l; i++) {
                    result = func(result, this[i][property]);
                }
            } else {
                //apply the reducer function along the array, using the value in the array
                for (var i = 1, l = this.length; i < l; i++) {
                    result = func(result, this[i]);
                }
            }
            return result;
        }
    }

    //evaluateProperty function
    evaluateProperty (object, property) {
        if (property instanceof Array) {
            this.each(property, function (part) {
                object = object[decodeURIComponent(part)];
            });
            return object;
        } else if (typeof property == "undefined") {
            return object;
        } else {
            return object[decodeURIComponent(property)];
        }
    }

    //missingOperator function
    missingOperator (operator) {
        throw new Error("Operator " + operator + " is not defined");
    }

//it appears this is never used. would explain why there are variables that are not defined (e.g. 'term')
/*
RqlArray.prototype.conditionEvaluator = function(condition){
	var jsOperator = this.jsOperatorMap[term.name];
	if(jsOperator){
		js += "(function(item){return item." + term[0] + jsOperator + "parameters[" + (index -1) + "][1];});";
	}
	else{
		js += "operators['" + term.name + "']";
	}
	return eval(js);
};
*/

    //executeQuery function
    //the main grinder to execute a query against a json array
    //query = the query string
    //options = option object
    //          .operators - an object containing additional operators that can be used by the query engine
    //          .parameters - an array of values to be mapped against $# placeholders.
    //                        e.g. ['abc'] would insert 'abc' wherever $1 is written in the query
    //target = the array to run the query against
    //returns: array of elements that satisfied the query
    executeQuery (query, options, target) {
        options = options || {};

        var that = this;

        //parse the query string
        var parser = new RqlParser();
        query = parser.parse(query, options.parameters);

        //generate a class T that has all the operators
        function T() { }
        T.prototype = this.operators;
        var operators = new T;
        // inherit any extra operators from options
        for (var i in options.operators) {
            operators[i] = options.operators[i];
        }
        //crafty function to call operators.
        //will be called by javascript constructed in a string and run via eval
        function op(name) {
            return operators[name] || that.missingOperator(name);
            /*
            if (operators[name]) {
                operators[name].targetData = target;
                return operators[name];
            } else {
                return that.missingOperator(name);
            }
            */
        }
        //var parameters = options.parameters || [];
        //var js = "";

        //this converts the query into a javascript function (in string form) that will execute the query against the array
        //value = the query (after parsing)
        function queryToJS(value) {
            if (value && typeof value === "object") {
                //query is a query object

                if (value instanceof Array) {
                    //call recursively on all elements of the array
                    return '[' + that.each(value, function (value, emit) {
                        emit(queryToJS(value));
                    }) + ']';
                } else {
                    var jsOperator = that.jsOperatorMap[value.name];
                    if (jsOperator) {
                        //it's a basic boolean operator (equals / greater / less / etc)
                        //build a path to the javascript property we want to test, testing for each part as we go
                        // item['foo.bar'] ==> (item && item.foo && item.foo.bar && ...)
                        var path = value.args[0];
                        var target = value.args[1];
                        var item;
                        if (typeof target == "undefined") {
                            item = "item";
                            target = path;
                        } else if (path instanceof Array) {
                            item = "item";
                            var escaped = [];
                            for (var i = 0; i < path.length; i++) {
                                escaped.push(that.stringify(path[i]));
                                item += "&&item[" + escaped.join("][") + ']';
                            }
                        } else {
                            item = "item&&item[" + that.stringify(path) + "]";
                        }

                        //make the condition, <path to value> <operator> <target>
                        // e.g. item && item["foo"] === "bar"
                        var condition = item + jsOperator + queryToJS(target);

                        //apply the condition against items in the array, using a filter to weed out those that fail it.  'this' is the array
                        // use native Array.prototype.filter if available
                        if (typeof Array.prototype.filter === 'function') {
                            return "(function(){return this.filter(function(item){return " + condition + "})})";
                            //???return "this.filter(function(item){return " + condition + "})";
                        } else {
                            return "(function(){var filtered = []; for(var i = 0, length = this.length; i < length; i++){var item = this[i];if(" + condition + "){filtered.push(item);}} return filtered;})";
                        }
                    } else {
                        //date case
                        if (value instanceof Date) {
                            return value.valueOf();
                        }
                        //otherwise its a fancy operator function (see RqlArray.operators above)
                        //apply the operator using the op function (declared above)
                        return "(function(){return op('" + value.name + "').call(this" +
                            (value && value.args && value.args.length > 0 ? (", " + that.each(value.args, function (value, emit) {
                                emit(queryToJS(value));
                            }).join(",")) : "") +
                            ")})";
                    }
                }
            } else {
                //query is not an object. return the value
                return typeof value === "string" ? that.stringify(value) : value;
            }
        }
        //generate the query function in string form, then turn it into a real function using eval
        var evaluator = eval("(1&&function(target){return " + queryToJS(query) + ".call(target);})");
        //apply the query function & return results
        return target ? evaluator(target) : evaluator;
    }
}