/* globals -$ */
'use strict';
var gulp = require('gulp');
var $ = require('gulp-load-plugins')({ lazy: true });

require('gulp-help')(gulp);

gulp.task('check', 'Checks code against style guidelines', function () {
    return gulp
        .src(['js/**/*.js'])
        .pipe($.jshint())
        .pipe($.jscs())
        .pipe($.jscsStylish.combineWithHintResults())   // combine with jshint results
        .pipe($.jshint.reporter('jshint-stylish', { verbose:true }))
        .pipe($.jshint.reporter('fail'));
});

gulp.task('serve', ['check'], function () {
    $.connect.server({ root:'.', port:6003 });
});

