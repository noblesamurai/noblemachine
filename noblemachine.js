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

var sys = require('sys'),
	events = require('events');

/**
 * Hybrid linear queue/state machine.
 */
var NobleMachine = function(funcOrAct) {
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

	me.addState('complete', function() {
		var me = this;

		if (me.completeHandler) {
			me.completeHandler.apply(me, arguments);
		} 

		me.onExit();

		if (!me.completeHandler) {
			me.emitSuccess.apply(me, arguments);
		}
	});

	me.addState('error', function() {
		var me = this;

		if (me.errorHandler) {
			me.errorHandler.apply(me, arguments);
		}

		me.onExit();

		if (!me.errorHandler) {
			me.emitError.apply(me, arguments);
		}
	});

	if (funcOrAct !== undefined) {
		me.next(funcOrAct);
	}

	return me;
}

sys.inherits(NobleMachine, events.EventEmitter);

/**
 * Internal function, converts a function or action into a state handler function.
 */
NobleMachine.prototype.makeHandler = function(funcOrAct) {
	var me = this;

	return function() {
		var state = me.state;

		if (funcOrAct === undefined) {
			me.toNext();
		} else if (funcOrAct instanceof Function) {
			funcOrAct.apply(me, arguments);

			if (me.state == state && !me.transitioning && me.running)  {
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
NobleMachine.prototype.addState = function(name, funcOrAct) {
	this.handlers[name] = this.makeHandler(funcOrAct);
}

/**
 * Add a named state at the next position in the main sequence.
 */
NobleMachine.prototype.nextState = function(name, funcOrAct) {
	this.addState(name, funcOrAct);
	this.stateSequence.push(name);
}

/**
 * Add an unnamed state at the next position in the main sequence.
 */
NobleMachine.prototype.next = function(funcOrAct) {
	this.nextState("state" + this.stateSequence.length, funcOrAct);
}

/**
 * Assign a handler to be called when the machine has successfully completed.
 */
NobleMachine.prototype.complete = function(handler) {
	this.completeHandler = handler;
}

/**
 * Assign a handler to be called when the machine encounters an error.
 */
NobleMachine.prototype.error = function(handler) {
	this.errorHandler = handler;
}

/**
 * Add a function to be run on machine exit regardless of exit status.
 */
NobleMachine.prototype.ensure = function(handler) {
	this.exitHandler = handler;
}

/**
 * Called on final exit.
 */
NobleMachine.prototype.onExit = function() {
	if (this.exitHandler) this.exitHandler();
}

/**
 * Retrieve a state name by main sequence index.
 */
NobleMachine.prototype.findState = function(nameOrIndex) {
	var me = this;

	if (typeof nameOrIndex == 'string') {
		return nameOrIndex;
	} else {
		return me.stateSequence[nameOrIndex];
	}
}

/**
 * Run the handler for the current state.
 */
NobleMachine.prototype.go = function(args) {
	var me = this;

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
NobleMachine.prototype.runState = function(nameOrIndex, args) {
	var me = this;

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
NobleMachine.prototype.transition = function(opts) {
    var me = this;

    opts = opts || {};
	opts.error = opts.error || 'error';
	opts.success = opts.success || 'complete';

    if (undefined == opts.action) {
        throw 'Transition added with no action';
    }

	var act = opts.action;


	act.addListener('success', function() {
		me.transitioning = false;
		me.runState(opts.success, arguments);
	});

	act.addListener('error', function() {
		me.transitioning = false;
		me.runState(opts.error, arguments);
	});

	me.transitioning = true;
	act.start();
}

/**
 * Transition directly to the given state with the given action or variable.
 */
NobleMachine.prototype.toState = function(nameOrIndex, actOrVar) {
	var me = this;

	var state = me.findState(nameOrIndex);

	if (actOrVar === undefined) {
		me.runState(state);
	} else if (actOrVar && actOrVar.start instanceof Function) {
		me.transition({ action: actOrVar, success: state });
	} else {
		me.runState(state, [actOrVar]);
	}
}

/**
 * Transition to the next state with the given action or variable.
 */
NobleMachine.prototype.toNext = function() {
	var me = this;

	var nextState = me.stateIndex+1;
	var args = Array.prototype.slice.call(arguments);

	if (nextState < me.stateSequence.length) {
		me.toState.apply(me, [nextState].concat(args));
	} else {
		me.toComplete.apply(me, args);
	}
}

/**
 * As above, but to the previous state.
 */
NobleMachine.prototype.toPrev = function() {
	var me = this;

	var nextState = me.stateIndex-1;
	var args = Array.prototype.slice.call(arguments);

	if (nextState < 0) {
		me.toError("Tried to transition earlier than the first state?!");
	} else {
		me.toState.apply(me, [nextState].concat(args));
	}
}

/**
 * Transition to the current state (i.e repeat it).
 */
NobleMachine.prototype.toRepeat = function() {
	me.toState(me, [me.stateIndex].concat(Array.prototype.slice.call(arguments)));
}

/**
 * Transition straight to completion.
 */
NobleMachine.prototype.toComplete = function() {
	this.toState.apply(this, ['complete'].concat(
		Array.prototype.slice.call(arguments)));
}

/**
 * Transition to error handler.
 */
NobleMachine.prototype.toError = function() {
	this.toState.apply(this, ['error'].concat(
		Array.prototype.slice.call(arguments)));
}

/**
 * Emit success event and mark machine as finished.
 */
NobleMachine.prototype.emitSuccess = function() {
	this.running = false;
    this.emit.apply(this, ['success'].concat(
        Array.prototype.slice.call(arguments)));
}

/** 
 * Emit error event and mark machine as finished.
 */
NobleMachine.prototype.emitError = function() {
	this.running = false;
	this.emit.apply(this, ['error'].concat(
        Array.prototype.slice.call(arguments)));
}

NobleMachine.logger = { log: sys.log, warning: sys.log, error: sys.log };

exports.NobleMachine = NobleMachine;
