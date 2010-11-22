/**
 * Copyright 2010 Noble Samurai
 * 
 * NobleRecord is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * NobleRecord is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with NobleRecord.  If not, see <http://www.gnu.org/licenses/>.
 */

var sys = require('sys'),
	events = require('events');

/**
 * An action
 */
function Action(_start) {
	var me = this;
	events.EventEmitter.call(me);

	me._start = _start;
	
	me.addListener('error', function(error) {
		// throw an exception when there are no listeners
		if (me.listeners('error').length == 1) {
			// Display error first
			if(error && error.stack) sys.puts(error.stack);
			var err = "Unhandled error in action: " + error;
			sys.puts(err);
			throw err;
		}	
	});

	me._subActions = [];


}
sys.inherits(Action, events.EventEmitter);

Action.prototype.addAction = function(subAction, opts) {
	var me = this;
	opts = opts || { bubbleErrors: true };
	me._subActions.push(subAction);

	if (opts.bubbleErrors) {
		subAction.addListener('error', function() {
			me._subActions.forEach(function(otherSubAction) {
				if (otherSubAction == subAction) return;
				otherSubAction.cancel();
			});
			me.emitError.apply(me, arguments);
		});
	}

	subAction.start();
}

Action.prototype.emitSuccess = function() {
	this.emit.apply(this, ['success'].concat(
		Array.prototype.slice.call(arguments)));
}

Action.prototype.emitError = function() {
	this.emit.apply(this, ['error'].concat(
		Array.prototype.slice.call(arguments)));
}

Action.prototype.addCallback = function(func) {
	this.addListener('success', func);
}

Action.prototype.addErrback = function(func) {
	this.addListener('error', func);
}

Action.prototype.addCancelback = function(func) {
	this.addListener('cancel', func);
}

Action.prototype.start = function() {
	var me = this;
	process.nextTick(function() {
		me._start();
	});
}

Action.prototype.cancel = function() {
	this._subActions.forEach(function(subAction) {
		subAction.cancel();
	});
	this.emit('cancel');
}

/**
 * A state machine action
 */
function StateMachine(_start) {
	var me = this;
	Action.call(me, _start);

	me._handlers = {};

	return me;
}
sys.inherits(StateMachine, Action);

StateMachine.prototype.addState = function(state, handler) {
	if (undefined != this._handlers[state]) {
		sys.error('Warning: a handler for ' + state + ' has already been defined.');
		return;
	}
	this._handlers[state] = handler;
}

StateMachine.prototype.transition = function(opts) {
	var me = this;

	opts = mixin({
		success: 'success',
		error: 'error',
	}, opts || {});
	
	if (undefined == opts.action) {
		throw 'Transition added with no action';
	}

	['success', 'error'].forEach(function(event) {
		if (!opts[event] && 'success' != event) return;
		opts.action.addListener(event, function() {
			if (opts[event]) me.state = opts[event];
			var args = Array.prototype.slice.call(arguments);
			// Workaround for emit bug: emit is passing through
			// 2 parameters regardless of whether the 2nd is defined.
			if (args[args.length-1] == undefined) args.pop();

			if (opts.data) {
				args = args.concat([opts.data]);
			}
			me.transitionNow.apply(me, args);
		});
	});

	me.addAction(opts.action, { bubbleErrors: !opts.error });
}

StateMachine.prototype.transitionNow = function() {
	if (undefined == this._handlers[this.state]) {
		sys.puts('Undefined state: ' + this.state);
		throw 'Undefined state: ' + this.state;
	}

	this._handlers[this.state].apply(this, arguments);
}

StateMachine.prototype.transitionTo = function(state) {
	this.state = state;
	this.transitionNow.apply(this, Array.prototype.slice.call(arguments, 1));
}

StateMachine.prototype.transitionQueue = function(finalState) {
	return new TransitionQueue(this, finalState);
}

StateMachine.prototype.linearQueue = function(finalState) {
	return new LinearQueue(this, finalState);
}

/**
 * A transition queue
 */
function TransitionQueue(stateMachine, finalState) {
	var me = this;
	events.EventEmitter.call(me);

	me.stateMachine = stateMachine;
	me.finalState = finalState;
	me._transitions = [];
	me._started = false;
}
sys.inherits(TransitionQueue, events.EventEmitter);

TransitionQueue.prototype.start = function() {
	var me = this;

	me._started = true;
	var completedItems = 0;
	if (me._transitions.length == 0) {
		me.stateMachine.transitionTo(me.finalState);
	}

	me._transitions.forEach(function(transition) {
		me.stateMachine.transition(transition);

		// Add the listeners after the transition listener to ensure they
		// occur last
		['success', 'error'].forEach(function(event) {
			// any event that has a handler should be counted as complete
			// (except the success event which is always counted).
			if (!transition[event] && 'success' != event) return;
			transition.action.addListener(event, function() {
				++completedItems;
				if (completedItems == me._transitions.length) {
					me.stateMachine.transitionTo(me.finalState);
				}
			});
		});
	});
}

TransitionQueue.prototype.cancel = function() {
	this._transitions.forEach(function(transition) {
		transition.action.cancel();
	});
}

TransitionQueue.prototype.addTransition = function(transition) {
	if (this._started) {
		throw 'Queue already started';
	}
	this._transitions.push(transition);
}

/**
 * A linear transition queue
 */
function LinearQueue(stateMachine, finalState) {
	var me = this;
	events.EventEmitter.call(me);

	me.stateMachine = stateMachine;
	me.finalState = finalState;
	me._transitions = [];
	me._started = false;
}
sys.inherits(LinearQueue, events.EventEmitter);

LinearQueue.prototype.start = function() {
	var me = this;

	me._started = true;
	me.completedItems = 0;
	if (me._transitions.length == 0) {
		me.stateMachine.transitionTo(me.finalState);
		return;
	}

	me.stateMachine.transition(me._transitions[0]);
}

LinearQueue.prototype.cancel = function() {
	this._transitions.forEach(function(transition) {
		transition.action.cancel();
	});
}

LinearQueue.prototype.addTransition = function(transition) {
	var me = this;

	if (me._started) {
		throw 'Queue already started';
	}

   ['success', 'error'].forEach(function(event) {
		   // any event that has a handler should be counted as complete
		   // (except the success event which is always counted).
		   if (!transition[event] && 'success' != event) return;
		   transition.action.addListener(event, function() {
				   me.completedItems += 1;
				   if (me.completedItems == me._transitions.length) {
						   // HACK (Daniel): Try to ensure that the state handler gets to run first.
						   last_transition = me._transitions[me._transitions.length-1];
						   states = [last_transition.success, last_transition.error];
														   
						   function finalTransition() {

								   if (states.indexOf(me.stateMachine.state) != -1) {
										   me.stateMachine.transitionTo(me.finalState)
								   } else {
										   setTimeout(finalTransition, 1000);
								   }
						   }

						   setTimeout(finalTransition, 10);
				   } else {
						   me.stateMachine.transition(me._transitions[me.completedItems]);
				   }
		   });
   });

   me._transitions.push(transition);

}

/**
 * Make an action that emits after a certain period of time
 *
 * @param int ms Number of microseconds before emitting success
 */
function makeSleeper(ms) {
	var timeout;

	var me = new Action(function() {
		timeout = setTimeout(function() {
			me.emit('success');
		}, ms);
	});

	me.addListener('cancel', function() {
		clearTimeout(timeout);
	});

	return me;
}

/**
 * Make a function that takes a callback as the last argument into an Action
 *
 * @param function func
 * @return Action
 */
function make(func) {
	var _active = true;
	var _func = func;
	var _args = Array.prototype.slice.call(arguments, 1);

	function error() {
		action.emitError.apply(action, arguments);
	}

	function success() {
		action.emitSuccess.apply(action, arguments);
	}

	var action = new Action(function() {
		_args.push(function(err) {
			if (!_active) return;
			if (err) {
				error.apply(this, [err]);
			} else {
				success.apply(this, Array.prototype.slice.call(arguments, 1));
			}
		});
		func.apply(this, _args);
	});

	action.addListener('cancel', function() {
		_active = false;
	});

	return action;
}

function NobleMachine(funcOrAct) {
	var me = this;
	
	me.pseudostates = 0;
	me.pseudostate = 0;

	_start = function() {
		if (funcOrAct && funcOrAct.start instanceof Function) {
			me.toNext(funcOrAct);
		} else if (funcOrAct === undefined) {
			me.toNext();
		} else {
			var ret = funcOrAct();


			if (me.state === undefined && me._subActions.length == 0) {
				me.toNext(ret);
			}
		}
	}

	StateMachine.call(me, _start);
}

sys.inherits(NobleMachine, StateMachine);

NobleMachine.prototype.next = function(funcOrAct) {
	var me = this;

	me.pseudostates += 1;

	me.addState("pseudostate" + me.pseudostates, function() {
		me.pseudostate = parseInt(me.state.replace(/[^\d]*/g, ''));

		var subactlen = me._subActions.length
		var state = me.state

		if (funcOrAct instanceof Function) {
			funcOrAct.apply(this, arguments);
		} else {
			me.toNext(funcOrAct);
		}

		if ((subactlen == me._subActions.length && me.state == state) && !me.delay) {
			me.toNext();
		}
	});
}

NobleMachine.prototype.first = function(funcOrAct) {
	this.next(funcOrAct);
}

NobleMachine.prototype.toPrev = function(action) {
	var me = this;

	if (me.pseudostate > me.pseudostates) {
		var prevstate = 'pseudostate' + (me.pseudostate);
	} else {
		var prevstate = 'pseudostate' + (me.pseudostate - 1);
	}

	me.toState(prevstate, action);
}

NobleMachine.prototype.nextState = function() {
	var me = this;

	if (me.pseudostate >= me.pseudostates) {
		return 'success';
	} else {
		return 'pseudostate' + (me.pseudostate + 1);
	}
}

NobleMachine.prototype.repeat = function(action) {
	this.toState(this.state, action);
}

NobleMachine.prototype.toNext = function(action) {
	this.toState(this.nextState(), action);
}

NobleMachine.prototype.toStateAfter = function(time, state, action) {
	var me = this;
	me.delay = true;
	setTimeout(function() { me.toState(state, action) }, time);
}

NobleMachine.prototype.toNextAfter = function(time, action) {
	this.toStateAfter(time, this.nextState(), action);
}

NobleMachine.prototype.toLast = function(action) {
	this.toState('success', action);
}

NobleMachine.prototype.toError = function(action) {
	this.toState('error', action);
}

NobleMachine.prototype.toState = function(state, action) {
	var me = this;

	me.delay = false;

	//if (action) {
		if (action && action.start instanceof Function) {
			me.transition({
				success: state,
				action: action
			})
		} else {
			me.transitionTo(state, action);
		}
	/*} else {
		me.transitionTo(state);
	}*/
}

NobleMachine.prototype.last = function(func) {
	this.onLast = func;
}

NobleMachine.prototype.error = function(func) {
	this.onError = func;
}

NobleMachine.prototype.ensure = function(func) {
	this.onExit = func;
}

NobleMachine.prototype.start = function() {
	var me = this;

	if (!me._handlers['success']) {
		if (me.onLast) {
			me.addState('success', me.onLast);
		} else {
			me.addState('success', function(result) { me.emitSuccess(result); });
		}
	}

	if (!me._handlers['error']) {
		if (me.onError) {
			me.addState('error', me.onError);
		} else {
			me.addState('error', function(err) { me.emitError(err); });
		}
	}

	if (me.onExit) {
		['success', 'error'].forEach(function(state) {
			if (me._handlers[state]) {
				var old = me._handlers[state];
				me._handlers[state] = function() {
					return me.onExit(old.apply(me, arguments));
				}
			}
		});
	}

	Action.prototype.start.call(me);
}

NobleMachine.prototype.emitSuccess = function(data) {
	this.delay = true;
	StateMachine.prototype.emitSuccess.call(this, data);
}

NobleMachine.prototype.emitError = function(data) {
	this.delay = true;
	StateMachine.prototype.emitError.call(this, data);
}

_.mixin(exports, {
	NobleMachine: NobleMachine,
});
