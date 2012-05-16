/**
 * Copyright 2010 Noble Samurai
 * 
 * NobleMachine is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * NobleMachine is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with NobleMachine.  If not, see <http://www.gnu.org/licenses/>.
 */

var util = require('util'),
	events = require('events');

/**
 * Hybrid linear queue/state machine.
 */
var NobleMachine = function(initialFuncOrAct) {
	var me = this;

	me.handlers = {};
	me.stateSequence = [];
	me.stateIndex = -1;

	me.start = function() {
		me.running = true;
		process.nextTick(function() {
			me.toNext();
		});
	}

	function arrify(args) {
		return Array.prototype.slice.call(args);
	}

	/**
	 * Internal function, converts a function or action into a state handler function.
	 */
	function makeHandler(funcOrAct) {
		return function() {
			var state = me.state;

			if (funcOrAct === undefined) {
				me.toNext();
			} else if (funcOrAct instanceof Function) {
				funcOrAct.apply(me, arrify(arguments));

				if (!funcOrAct.wait && me.state == state && !me.transitioning && me.running) {
					me.toNext();
				}
			} else {
				me.toNext(funcOrAct);
			}
		}
	}

	/**
	 * Add a named state without placing it in the main sequence.
	 */
	function addState(name, funcOrAct) {
		me.handlers[name] = me.makeHandler(funcOrAct);
		return me;
	}

	/**
	 * Add a named state at the next position in the main sequence.
	 */
	function nextState(name, funcOrAct) {
		me.addState(name, funcOrAct);
		me.stateSequence.push(name);
		return me;
	}

	/**
	 * Add an unnamed state at the next position in the main sequence.
	 */
	function next(funcOrAct) {
		return me.nextState("state" + me.stateSequence.length, funcOrAct);
	}

	/**
	 * Assign a handler to be called when the machine has successfully completed.
	 */
	function complete(handler) {
		me.completeHandler = handler;
	}

	/**
	 * Assign a handler to be called when the machine encounters an error.
	 */
	function error(handler) {
		me.errorHandler = handler;
	}

	/**
	 * Add a function to be run on machine exit regardless of exit status.
	 */
	function ensure(handler) {
		me.exitHandler = handler;
	}

	/**
	 * Called on final exit.
	 */
	function onExit() {
		if (me.exitHandler) me.exitHandler();
	}

	/**
	 * Retrieve a state name by main sequence index.
	 */
	function findState(nameOrIndex) {
		if (typeof nameOrIndex == 'string') {
			return nameOrIndex;
		} else {
			return me.stateSequence[nameOrIndex];
		}
	}

	/**
	 * Run the handler for the current state.
	 */
	function go(args) {
		try {
			me.handlers[me.state].apply(me, args);
		} catch (e) {
			if (e.stack) NobleMachine.logger.error(e.stack);
			if (me.state == 'error') {
				me.emitError(e);
			} else {
				me.toError(e);
			}
		}
	}

	/**
	 * Switch to a given state and proceed.
	 */
	function runState(nameOrIndex, args) {
		me.state = me.findState(nameOrIndex);

		var index = me.stateSequence.indexOf(me.state);
		if (index != -1) me.stateIndex = index;


		if (args) {
			me.go(args);	
		} else {
			me.go();
		}
	}

	/**
	 * Add a state transition involving an action and success/error response states.
	 */
	function transition(opts) {
		opts = opts || {};
		opts.error = opts.error || 'error';
		opts.success = opts.success || 'complete';

		if (undefined == opts.action) {
			throw 'Transition added with no action';
		}

		var act = opts.action;


		act.addListener('success', function() {
			me.transitioning = false;
			me.runState(opts.success, (opts.argdata||[]).concat(arrify(arguments)));
		});

		act.addListener('error', function() {
			me.transitioning = false;
			me.runState(opts.error, arrify(arguments));
		});

		me.transitioning = true;
		act.start();
	}

	/**
	 * Transition directly to the given state with the given action or variable.
	 */
	function toState(nameOrIndex) {
		var args = Array.prototype.slice.call(arguments, 1);
		var state = me.findState(nameOrIndex);

		if (args.length == 0) {
			me.runState(state);
		} else if (args[0] && args[0].start instanceof Function) {
			me.transition({ action: args[0], success: state, argdata: args.slice(1) });
		} else {
			me.runState(state, args);
		}
	}

	/**
	 * Transition to the next state with the given action or variable.
	 */
	function toNext() {
		var nextState = me.stateIndex+1;
		var args = arrify(arguments);

		if (nextState < me.stateSequence.length) {
			me.toState.apply(me, [nextState].concat(args));
		} else {
			me.toComplete.apply(me, args);
		}
	}

	/**
	 * As above, but to the previous state.
	 */
	function toPrev() {
		var nextState = me.stateIndex-1;
		var args = arrify(arguments);

		if (nextState < 0) {
			me.toError("Tried to transition earlier than the first state?!");
		} else {
			me.toState.apply(me, [nextState].concat(args));
		}
	}

	/**
	 * Transition to the current state (i.e repeat it).
	 */
	function toRepeat() {
		me.toState.apply(me, [me.stateIndex].concat(arrify(arguments)));
	}

	/**
	 * Transition straight to completion.
	 */
	function toComplete() {
		me.toState.apply(me, ['complete'].concat(
			arrify(arguments)));
	}

	/**
	 * Transition to error handler.
	 */
	function toError() {
		me.toState.apply(me, ['error'].concat(
			arrify(arguments)));
	}

	/**
	 * Emit success event and mark machine as finished.
	 */
	function emitSuccess() {
		me.running = false;
		me.emit.apply(me, ['success'].concat(
			arrify(arguments)));
	}

	/** 
	 * Emit error event and mark machine as finished.
	 */
	function emitError() {
		me.running = false;
		me.emit.apply(me, ['error'].concat(
			arrify(arguments)));
	}

	['makeHandler', 'addState', 'nextState', 'next', 'complete', 'error', 'ensure', 'onExit', 'findState', 'go', 
	 'runState', 'transition', 'toState', 'toNext', 'toPrev', 'toRepeat', 'toComplete', 'toError', 'emitSuccess', 
	 'emitError'].forEach(function(funcName) {
		 me[funcName] = eval(funcName);
	});

	me.next.wait = me.nextState.wait = me.addState.wait = function(handler) {
		handler.wait = true;
		return this(handler);
	}

	me.addState('complete', function() {
		if (me.completeHandler) {
			me.completeHandler.apply(me, arrify(arguments));
		} 

		me.onExit();

		if (me.running && !me.completeHandler) {
			me.emitSuccess.apply(me, arrify(arguments));
		}
	});

	me.addState('error', function() {
		if (me.errorHandler) {
			me.errorHandler.apply(me, arrify(arguments));
		}

		me.onExit();

		if (!me.errorHandler) {
			me.emitError.apply(me, arrify(arguments));
		}
	});

	if (initialFuncOrAct !== undefined) {
		me.next(initialFuncOrAct);
	}

	return me;
}

util.inherits(NobleMachine, events.EventEmitter);

NobleMachine.logger = { log: util.log, warning: util.log, error: util.log };

exports.NobleMachine = NobleMachine;
