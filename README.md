# noblemachine
##### <span style="color: #333">a framework for amicable asynchronous coding with node.js</span> 

## introduction

Standard callback-based asynchronous programming is sufficient for small operations, but quickly balloons in size and complexity as a project grows. NobleMachine provides a framework based around finite state machines which permits the frequent invocation of asynchronous operations while avoiding the loss of an intuitive linear coding style.

## general usage

	var NobleMachine = require('noblemachine').NobleMachine;

A NobleMachine is divided into states, which are defined by (generally anonymous) functions. When the machine is run, the state handlers are executed by default in the sequence of their addition. Handlers can be set to wait for a manual transition at the point of creation using next.wait; else the machine will proceed automatically if it does not detect a transition call.

	var act = new NobleMachine();

	act.next.wait(function() {
		fs.readdir("/root/", act.toNext);
	});

	act.next(function(err, omgfiles) {
		sys.log(omgfiles);
	});

	act.start();

## chaining

When passed another NobleMachine, the state transition functions will automatically execute that machine prior to the transition. Whatever output is passed from the final state will be treated as input to the following state of the parent machine.

	function readDirAct(path) {
		return new NobleMachine().next.wait(function() {
			fs.readdir(path, act.toNext); 
		});
	}

	var act = new NobleMachine();

	act.next(function() {
		act.toNext(readDirAct('/root/'));
	});

	act.next(function(err, omgfiles) {
		sys.log(omgfiles);
	});

	act.start();

## error handling

Exceptions that occur within state handlers are captured and passed to the machine's error handler, if present. Otherwise they will bubble to the parent machine. The error handler should use act.emitSuccess() or act.emitError() to indicate that the error has been successfully handled or not respectively.

    var act = new NobleMachine();

    act.next(function() {
        someundefinedfunctionlalala();
    });

    act.error(function(err) {
        if (err instanceof ReferenceError) {
            act.emitSuccess("I don't care about reference errors!");
        } else {
            act.emitError(err);
        }
    });

    act.start();

## non-linear transitions

Functions such as toPrev(), toRepeat(), toError() and toComplete() can be used to jump directly to the corresponding handlers in the machine, and work on much the same principles as toNext(). Additionally, named, sequence-independent states can be constructed and transitioned to using addState() and toState() (be aware that the 'error' and 'complete' state names are reserved for internal use).

    var act = new NobleMachine().next(function() { act.toState('bakecookie') });

    act.addState('bakecookie', function() {
        act.toState('consumecookie', bakeCookieAct());
    });

    act.addState('consumecookie', function(cookie) {
        if (canHas(cookie)) {
            act.toNext(cookie);
        } else {
            act.toState('bakecookie');
        }
    });

    act.start();

## miscellaneous

The 'ensure' function adds a handler that will be run on machine exit regardless of whether an error has occurred.

	act.ensure(function() {
		db.close();
	});

## installation

Noble Machine is also made available as an npm package. To install:

	npm install noblemachine

To use Noble Machine from the npm package do:

	var NobleMachine = require('noblemachine').NobleMachine;

## contributors
 - [Daniel Assange](http://github.com/somnidea) (link defunct)
 - [Anneli Cuss](http://github.com/celtic)
 - [Eugene Ware](http://eugeneware.com)
 - You?

## license

Copyright 2010 Noble Samurai

NobleMachine is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

NobleMachine is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with NobleMachine.  If not, see http://www.gnu.org/licenses/.

