//---------------------------
// Parser Class
//
// used to parse query strings into query objects 
//---------------------------

export default class RqlParser {

    constructor () {

        this.operatorMap = {
            "=": "eq",
            "==": "eq",
            ">": "gt",
            ">=": "ge",
            "<": "lt",
            "<=": "le",
            "!=": "ne"
        };

        this.commonOperatorMap = {
            "and": "&",
            "or": "|",
            "eq": "=",
            "ne": "!=",
            "le": "<=",
            "ge": ">=",
            "lt": "<",
            "gt": ">"
        };

        this.primaryKeyName = 'id';
        this.lastSeen = ['sort', 'select', 'values', 'limit'];
        this.jsonQueryCompatible = true;

        this.autoConverted = {
            "true": true,
            "false": false,
            "null": null,
            "undefined": undefined,
            "Infinity": Infinity,
            "-Infinity": -Infinity
        };

        //big mapping of converter functions (functions that convert data to values in their proper data type)
        this.converters = {
            //auto. attempt basic conversion for keywords, numbers, strings, dates
            auto: function (string) {
                //keywords
                if (this.autoConverted.hasOwnProperty(string)) {
                    return this.autoConverted[string];
                }
                //number check
                var number = +string;

                if (isNaN(number) || number.toString() !== string) {
                    string = decodeURIComponent(string);
                    if (this.jsonQueryCompatible) {
                        //if wrapped in single quotes, switch to be wrapped in double quotes. then parse as JSON
                        if (string.charAt(0) == "'" && string.charAt(string.length - 1) == "'") {
                            return JSON.parse('"' + string.substring(1, string.length - 1) + '"');
                        }
                    }
                    //string
                    return string;
                }
                //number
                return number;
            },
            number: function (x) {
                var number = +x;
                if (isNaN(number)) {
                    throw new URIError("Invalid number " + number);
                }
                return number;
            },
            epoch: function (x) {
                var date = new Date(+x);
                if (isNaN(date.getTime())) {
                    throw new URIError("Invalid date " + x);
                }
                return date;
            },
            isodate: function (x) {
                // four-digit year
                var date = '0000'.substr(0, 4 - x.length) + x;
                // pattern for partial dates
                date += '0000-01-01T00:00:00Z'.substring(date.length);
                return this.converters.date(date);
            },
            date: function (x) {
                var isoDate = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/.exec(x),
                    dDate;
                if (isoDate) {
                    dDate = new Date(Date.UTC(+isoDate[1], +isoDate[2] - 1, +isoDate[3], +isoDate[4], +isoDate[5], +isoDate[6]));
                } else {
                    dDate = new Date(x);
                }
                if (isNaN(dDate.getTime())) {
                    throw new URIError("Invalid date " + x);
                }
                return dDate;
            },
            "boolean": function (x) {
                return x === "true";
            },
            string: function (string) {
                return decodeURIComponent(string);
            },
            re: function (x) {
                return new RegExp(decodeURIComponent(x), 'i');
            },
            RE: function (x) {
                return new RegExp(decodeURIComponent(x));
            },
            glob: function (x) {
                var s = decodeURIComponent(x).replace(/([\\|\||\(|\)|\[|\{|\^|\$|\*|\+|\?|\.|\<|\>])/g, function (x) { return '\\' + x; }).replace(/\\\*/g, '.*').replace(/\\\?/g, '.?');
                if (s.substring(0, 2) !== '.*') s = '^' + s; else s = s.substring(2);
                if (s.substring(s.length - 2) !== '.*') s = s + '$'; else s = s.substring(0, s.length - 2);
                return new RegExp(s, 'i');
            }
        };

        //set the default converter to the auto-converter function
        this.converters["default"] = this.converters.auto;
    }

    //main parse function
    parse (query, parameters) {
        //init bad input
        if (typeof query === "undefined" || query === null) {
            query = '';
        }

        var term = new RqlQuery();
        var topTerm = term;
        topTerm.cache = {}; // room for lastSeen params

        //lets start parsing this query
        if (typeof query === "object") {
            if (query instanceof RqlQuery) {
                //its already parsed!
                return query;
            }
            //not sure what this does.
            //if query is an object, but not an RqlQuery, go through the object properties and turn them into query terms.
            //TODO revisit with better explanation. it may be this is not used when parsing string-based queries, only funny chained functions
            for (var i in query) {
                var qTerm = new RqlQuery();
                topTerm.args.push(qTerm);
                qTerm.name = "eq";
                qTerm.args = [i, query[i]]; //property-value pair array
            }
            return topTerm;
        }

        //I WILL NOT TOLERATE YOUR QUESTION MARK INSOLENCE
        if (query.charAt(0) == "?") {
            throw new URIError("Query must not start with ?");
        }

        //as far as i can tell, jsonQueryCompatible is always true
        //replace angle bracket symbols ( >= <= > < ) with text formula equivalents
        if (this.jsonQueryCompatible) {
            query = query.replace(/%3C=/g, "=le=").replace(/%3E=/g, "=ge=").replace(/%3C/g, "=lt=").replace(/%3E/g, "=gt=");
        }

        if (query.indexOf("/") > -1) { // performance guard
            // convert slash delimited text to arrays
            query = query.replace(/[\+\*\$\-:\w%\._]*\/[\+\*\$\-:\w%\._\/]*/g, function (slashed) {
                return "(" + slashed.replace(/\//g, ",") + ")";
            });
        }

        // convert FIQL to normalized call syntax form
        query = query.replace(/(\([\+\*\$\-:\w%\._,]+\)|[\+\*\$\-:\w%\._]*|)([<>!]?=(?:[\w]*=)?|>|<)(\([\+\*\$\-:\w%\._,]+\)|[\+\*\$\-:\w%\._]*|)/g,
                            //<---------       property        -----------><------  operator -----><----------------   value ------------------>
                function (t, property, operator, value) {
                    if (operator.length < 3) {
                        if (!this.operatorMap[operator]) {
                            throw new URIError("Illegal operator " + operator);
                        }
                        operator = this.operatorMap[operator];
                    }
                    else {
                        operator = operator.substring(1, operator.length - 1);
                    }
                    return operator + '(' + property + "," + value + ")";
                });

        //STILL TRYING TO QUESTION MARK, EH? I HOP OVER YOUR SILLYNESS
        if (query.charAt(0) == "?") {
            query = query.substring(1);
        }

        //get leftover chars from the query
        //this could be things like more and/ors, or a comma to apply a sort or filter
        var leftoverCharacters = query.replace(/(\))|([&\|,])?([\+\*\$\-:\w%\._]*)(\(?)/g,
                            //    <-closedParan->|<-delim-- propertyOrValue -----(> |
            function (t, closedParan, delim, propertyOrValue, openParan) {
                if (delim) {
                    if (delim === "&") {
                        setConjunction("and");
                    }
                    if (delim === "|") {
                        setConjunction("or");
                    }
                }
                if (openParan) {
                    var newTerm = new RqlQuery();
                    newTerm.name = propertyOrValue;
                    newTerm.parent = term;
                    call(newTerm);
                }
                else if (closedParan) {
                    var isArray = !term.name;
                    term = term.parent;
                    if (!term) {
                        throw new URIError("Closing paranthesis without an opening paranthesis");
                    }
                    if (isArray) {
                        term.args.push(term.args.pop().args);
                    }
                }
                else if (propertyOrValue || delim === ',') {
                    term.args.push(this.stringToValue(propertyOrValue, parameters));

                    // cache the last seen sort(), select(), values() and limit()
                    if (this.contains(this.lastSeen, term.name)) {
                        topTerm.cache[term.name] = term.args;
                    }
                    // cache the last seen id equality
                    if (term.name === 'eq' && term.args[0] === this.primaryKeyName) {
                        var id = term.args[1];
                        if (id && !(id instanceof RegExp)) id = id.toString();
                        topTerm.cache[this.primaryKeyName] = id;
                    }
                }
                return "";
            });

        //balanced paranthesis check
        if (term.parent) {
            throw new URIError("Opening paranthesis without a closing paranthesis");
        }

        //if we found leftover chars, get angry
        if (leftoverCharacters) {
            // any extra characters left over from the replace indicates invalid syntax
            throw new URIError("Illegal character in query string encountered " + leftoverCharacters);
        }

        //worker bee functions

        function call(newTerm) {
            term.args.push(newTerm);
            term = newTerm;
            // cache the last seen sort(), select(), values() and limit()
            if (this.contains(this.lastSeen, term.name)) {
                topTerm.cache[term.name] = term.args;
            }
        }
        function setConjunction(operator) {
            if (!term.name) {
                term.name = operator;
            }
            else if (term.name !== operator) {
                throw new Error("Can not mix conjunctions within a group, use paranthesis around each set of same conjuctions (& and |)");
            }
        }
        function removeParentProperty(obj) {
            if (obj && obj.args) {
                delete obj.parent;
                var args = obj.args;
                for (var i = 0, l = args.length; i < l; i++) {
                    removeParentProperty(args[i]);
                }
            }
            return obj;
        };

        //remove the parent properties from our query tree
        removeParentProperty(topTerm);

        //return a nicely parsed thing
        return topTerm;
    }

    //contains function
    //TODO can this be replaced by a simple built-in array function, like indexOf?
    contains (array, item) {
        for (var i = 0, l = array.length; i < l; i++) {
            if (array[i] === item) {
                return true;
            }
        }
    }

    //parseGently function
    // dumps undesirable exceptions to RqlQuery().error
    parseGently () {
        var terms;
        try {
            terms = this.parse.apply(this, arguments);
        } catch (err) {
            terms = new RqlQuery();
            terms.error = err.message;
        }
        return terms;
    }

    //stringToValue function
    //converts string representations of things into values of the proper data type
    stringToValue (str, parameters) {
        var converter = this.converters['default'];
        if (str.charAt(0) === "$") {
            var param_index = parseInt(str.substring(1)) - 1;
            return param_index >= 0 && parameters ? parameters[param_index] : undefined;
        }
        if (str.indexOf(":") > -1) {
            var parts = str.split(":", 2);
            converter = this.converters[parts[0]];
            if (!converter) {
                throw new URIError("Unknown converter " + parts[0]);
            }
            str = parts[1];
        }
        return converter(str);
    }

}