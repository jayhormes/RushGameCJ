!function(a) {
	"use strict";
	
	var detection = (function() {
		var mod = {is:{}},
			d,
			ua = navigator.userAgent;
		mod.detect = {
			html5: function() {
				return document.createElement('canvas').getContext !== undefined;
			},
			touch: function() {
				var supportsTouch = 'ontouchstart' in window || navigator.msMaxTouchPoints;
				return !!supportsTouch;
			},
			android: function() {
				return !!ua.match(/Android/i);
			},
			ios: function() {
				return !!ua.match(/iPhone|iPad|iPod/i);
			},
			ios7: function(){
				return mod.detect.ios && ua.match(/version\/7\./i);
			},
			bb10: function() {
				return !!ua.match(/BB10/i);
			},
			windows: function() {
				return !!ua.match(/Windows/i);
			},
			webkitVersion: function() {
				var regex = new RegExp(/AppleWebKit\/([\d.]+)/),
					result = regex.exec(ua),
					webkitVersion = result === null ? false : parseFloat(result[1]);
				return webkitVersion;
			},
			androidStockBrowser: function() {
				if (mod.is.android && mod.is.webkitVersion && mod.is.webkitVersion < 537) {
					return true;
				}
				return false;
			},
			standalone: function() {
				return !!window.navigator.standalone;
			},
			smartphone: function() {
				return (ua.match(/Android.*Mobile|iPhone|IEMobile|WPDesktop|BB10/i)) ? true : false;
			},
			tablet: function() {
				// Android smartphones have the combination Android...Mobile, tablets only Android
				var androidTablet = (mod.is.android && !mod.is.smartphone),
					iPad = ua.match(/iPad/i) ? true : false;
				return (androidTablet || iPad);
			},
			pc: function() {
				return (!mod.is.smartphone && !mod.is.tablet);
			},
			phantom: function() {
				return !!(window.callPhantom || ua.match(/PhantomJS/));
			},
			iframe: function(){
				return window.self != window.top;
			}
		};

		for (d in mod.detect) {
			if (typeof mod.detect[d] === 'function') {
				mod.is[d] = mod.detect[d]();
			}
		}

		return mod;
	})();

	var socketURI = "ws://localhost:3002/sock";
	
	if (document.location.href.indexOf("localhost") === -1) {
	    socketURI = "wss://staging.api.html5games.com/sock";
	}

	var sessionData = {
		"uid": "",
		"app": ""
	};
	var sessionNr = 0;
	var sessions = {};
	var canonical = document.querySelector('link[rel="canonical"]');
	if (canonical && canonical.getAttribute("href")) {
		sessionData.uri = canonical.getAttribute("href");
	} else {
		sessionData.uri  = document.location.protocol + "//" + document.location.host;
	}
	sessionData.path = document.location.pathname;
	sessionData.ref  = document.referrer || "";
	sessionData.lang = getNavigatorLanguage() || "";
	sessionData.res  = screen.width + "x" + screen.height;
	sessionData.dc   = (detection.is.pc ? 'desktop' : (detection.is.tablet ? 'tablet' : (detection.is.smartphone ? 'mobile' : 'other')));
	sessionData.os   = (detection.is.windows ? 'windows' : (detection.is.android ? 'android' : (detection.is.ios ? 'ios' : 'other')));
	sessionData.ifr  = (detection.is.iframe ? "1" : "0");

	var debugMode = false;
	var logger = function() {};
	var liveData = {
		err: 0,
		dur: 0,
		sess: ""
	};
	var keepaliveTimeout = 10;
	var keepaliveTimeoutId = 0;
	var pageVisibility = 1;
	var hidden, visibilityChange; 
	if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support 
		hidden = "hidden";
		visibilityChange = "visibilitychange";
	} else if (typeof document.msHidden !== "undefined") {
		hidden = "msHidden";
		visibilityChange = "msvisibilitychange";
	} else if (typeof document.webkitHidden !== "undefined") {
		hidden = "webkitHidden";
		visibilityChange = "webkitvisibilitychange";
	}

	function handleVisibilityChange() {
		if (document[hidden] || document[visibilityChange] === 'hidden') {
			pageVisibility = 0;
		} else {
			pageVisibility = 1;
		}
	}
	// Handle page visibility change
	document.addEventListener(visibilityChange, handleVisibilityChange, false);

	handleVisibilityChange();

	function initSession(appName, _debugMode, _logger) {
		sessionData.app = appName.toLowerCase().replace(/\s/g, "-") || "unknown";
		sessionData.deb = !!_debugMode ? "1" : "0";
		debugMode = !!_debugMode;
		logger = _logger || logger;
		try {
			sessionData.uid = window.localStorage.getItem("html5games_uid") || "";
		} catch (ex) {
			console.log("something went wrong, start a new session");
		}

		!function(sessionNr) {
			var ws;
			var retryCount = 0;

			sessions[sessionNr] = { sock: ws, sd: {}, ld: {} };

			!function connect() {
				ws = new WebSocket(socketURI + "/v0.9/sessions");

				ws.onopen = function open() {
					keepaliveSession();
				};

				ws.onclose = function close() {
					// panic mode! stop the interval
					if (keepaliveTimeoutId) {
						clearTimeout(keepaliveTimeoutId);
					}
					setTimeout(connect, retryCount * 4E3);
				};

				ws.onmessage = function incoming(event) {
					var msg = JSON.parse(event.data);
					//if (debugMode) logger("message", msg);
					switch (msg.type) {
						case "plays_count":
							updateNbPlays(msg.n);
							updateNbPlaysperuser();
							break;
						case "players_count":
							updateNbPlayers(msg.n);
							updateNbPlaysperuser();
							break;
						case "engagement_count":
							updateNbSeconds(msg.n);
							updateNbMinutes(msg.n);
							break;
						case "greeting": 
							if (sessionData.uid === "") {
								sessionData.uid = msg.uid;
								try {
									window.localStorage.setItem("html5games_uid", sessionData.uid);
								} catch (ex) {
									console.log("localStorage is full or not supported");
								}
							}
							liveData.sess = sessionData.id = (sessionData.id ? sessionData.id : sessionData.uid + "." + sessionData.app + "." + msg.beg);
							sessions[sessionNr].sd = JSON.parse(JSON.stringify(sessionData));
							sessions[sessionNr].ld = JSON.parse(JSON.stringify(liveData));
							ws.send(JSON.stringify({"type": "sd", "payload": sessions[sessionNr].sd}));
							updateSession();
							break;
					}
				};

				retryCount++;
			}();

			function keepaliveSession() {
				keepaliveTimeoutId = setTimeout(function() {
					if (pageVisibility === 1) {
						sessions[sessionNr].ld.dur += keepaliveTimeout;

						if (sessions[sessionNr].ld.dur % 10 === 0) { 
							ws.send(JSON.stringify({"type": "ld", "payload": sessions[sessionNr].ld}));
						}

						updateSession();
					}

					// check again after timeout
					keepaliveSession();
				}, keepaliveTimeout * 1E3);
			}
		}(sessionNr++);
	}

	var oldOnError = window.onerror;
	window.onerror = function() {
		if (debugMode) console.log("error", arguments);
		sessions[0].ld.err++;
		if (typeof oldOnError === "function") {
			oldOnError.apply(arguments);
		}
	}

	var counters = {
		nbPlays: null,
		nbPlayers: null,
		nbMinutes: null
	};
	var countOpts = {
		useEasing: true, 
		useGrouping: true, 
		separator: '.', 
		decimal: ',', 
	};
	function updateNbPlays(n) {
		n = Number(n) || 0;
		if (debugMode) {
			if (!counters.nbPlays) {
				counters.nbPlays = new CountUp(document.querySelector('#plays-container > span'), 0, n, 0, 5, countOpts);
				if (!counters.nbPlays.error) {
					counters.nbPlays.start();
				} else {
					console.error(counters.nbPlays.error);
				}
			} else {
				counters.nbPlays.update(n);
			}
			document.querySelector('#plays-container > span').setAttribute("data-value", n);
		}
	}
	function updateNbPlaysperuser() {
		if (debugMode) {
			var users = Number(document.querySelector('#players-container > span').getAttribute("data-value"));
			var plays = Number(document.querySelector('#plays-container > span').getAttribute("data-value"));
			if (users > 0 && plays > 0) {
				document.querySelector('#plays-container2 > span').innerHTML = Math.round(plays / users) + "," + ((plays % users).toString().substr(0, 2)).padStart("0", 2).padEnd("0", 2);
			}
		}
	}

	function updateNbPlayers(n) {
		n = Number(n) || 0;
		if (debugMode) {
			if (!counters.nbPlayers) {
				counters.nbPlayers = new CountUp(document.querySelector('#players-container > span'), 0, n, 0, 5, countOpts);
				if (!counters.nbPlayers.error) {
					counters.nbPlayers.start();
				} else {
					console.error(counters.nbPlayers.error);
				}
			} else {
				counters.nbPlayers.update(n);
			}
			document.querySelector('#players-container > span').setAttribute("data-value", n);
			var plays = Number(document.querySelector('#plays-container > span').getAttribute("data-value"));
			if (plays > 0 && n > 0) {
				document.querySelector('#plays-container2 > span').innerHTML = Math.round(plays / n) + "," + ((plays % n).toString().substr(0, 2)).padStart("0", 2).padEnd("0", 2);
			}
		}
	}

	function updateNbSeconds(n) {
		n = Number(n) || 0;
		n = Math.floor(n * keepaliveTimeout);
		if (debugMode) {
			var users = Number(document.querySelector('#players-container > span').getAttribute("data-value"));
			if (users > 0) {
				document.querySelector('#engagement-container3 > span').innerHTML = seconds2time(n / users);
			}
		}
	}

	function seconds2time(n) {
		var hours   = Math.floor(n / 3600);
		var minutes = Math.floor((n - (hours * 3600)) / 60);
		var seconds = Math.round(n - (hours * 3600) - (minutes * 60));
		var time = "";

		if (hours > 0) {
			time = hours+":";
		}
		if (minutes > 0 || time !== "") {
			minutes = (minutes < 10 && time !== "") ? "0"+minutes : String(minutes);
			time += minutes+":";
		}
		if (time === "") {
			time = seconds+"s";
		}
		else {
			time += (seconds < 10) ? "0"+seconds : String(seconds);
		}
		return time;
	}

	function updateNbMinutes(n) {
		n = Number(n) || 0;
		n = Math.floor(n / 60 * keepaliveTimeout);
		if (debugMode) {
			if (!counters.nbMinutes) {
				counters.nbMinutes = new CountUp(document.querySelector('#engagement-container2 > span'), 0, n, 0, 5, countOpts);
				if (!counters.nbMinutes.error) {
					counters.nbMinutes.start();
				} else {
					console.error(counters.nbMinutes.error);
				}
			} else {
				counters.nbMinutes.update(n);
			}
			document.querySelector('#engagement-container2 > span').setAttribute("data-value", n);
		}
	}

	function updateSession() {
		if (debugMode) {
			document.getElementById('session-container').innerHTML = '<pre>' + JSON.stringify(sessionData, undefined, "\t") + "\n\n" + JSON.stringify(sessions[0].ld, undefined, "\t") + '</pre>';
		}
	}

	function getNavigatorLocale() {
		var language = "";

		if (navigator.languages) {
			language = navigator.languages[0];
		} else if (navigator.language) {
			language = navigator.language;
		} else if (navigator.userLanguage) {
			language = navigator.userLanguage;
		} else if (navigator.browserLanguage) {
			language = navigator.browserLanguage;
		}

		return language;
	}

	function getNavigatorLanguage() {
		return getNavigatorLocale().substr(0, 2);
	}

	a.html5games_api = {
		"init": initSession
	};
}(window);