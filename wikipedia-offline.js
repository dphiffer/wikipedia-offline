(function() {
	
	// As a learning exercise, I'm doing this without any libraries
	// $ is just a shortcut to querySelectorAll
	function $(query) {
		return document.querySelectorAll(query);
	}
	
	function Page() {
		this.url = null;
		this.wikipedia = new Wikipedia(this.articleDomain());
		this.indexedDB = new IndexedDB('mediawiki', 5, function(db) {
			if (db.objectStoreNames.contains('articles')) {
				db.deleteObjectStore('articles');
			}
			db.createObjectStore('articles', { keyPath: 'url' });
			if (db.objectStoreNames.contains('media')) {
				db.deleteObjectStore('media');
			}
			db.createObjectStore('media');
			if (db.objectStoreNames.contains('mediaArticles')) {
				db.deleteObjectStore('mediaArticles');
			}
			db.createObjectStore('mediaArticles');
		});
		this.search = new SearchBox(this);
		this.search.input.focus();
		this.saved = new SavedList(this);
		this.setupLinkListener();
	}
	
	Page.prototype.setupLinkListener = function() {
		var self = this;
		document.body.addEventListener('click', function(e) {
			var link;
			if (e.target) {
				if (e.target.nodeName == 'A') {
					link = e.target;
				} else if (e.target.parentNode &&
				           e.target.parentNode.nodeName == 'A') {
					link = e.target.parentNode;
				}
				self.search.clickHandler(e.target);
			}
			if (link) {
				var title = titleDecode(link.getAttribute('href'));
				if (title) {
					var hash = hashDecode(link.getAttribute('href'));
					self.load(title, hash);
					e.preventDefault();
					return false;
				}
			}
		}, false);
	};
	
	Page.prototype.load = function(title, hash) {
		if (this.search.input) {
			this.search.input.blur();
		}
		var url = this.articleURL(title);
		var self = this;
		this.mediaList = [];
		this.indexedDB.get('articles', url, function(article) {
			if (article) {
				self.url = url;
				self.display(article, hash);
			} else {
				self.wikipedia.load(title, function(data) {
					var article = data.mobileview;
					if (article.redirected) {
						url = self.articleURL(article.redirected);
					}
					article.url = url;
					var html = '';
					for (var i = 0; i < article.sections.length; i++) {
						html += article.sections[i].text;
					}
					article.html = self.filterHTML(html);
					article.media = self.mediaList;
					self.url = url;
					self.display(article, hash);
					self.indexedDB.put('articles', article);
					self.saved.update();
				});
			}
		});
	};
	
	Page.prototype.display = function(article, hash) {
		var html = '';
		for (var i = 0; i < article.sections.length; i++) {
			html += article.sections[i].text;
		}
		var bodyContent = $('#bodyContent')[0];
		bodyContent.innerHTML = article.html;
		this.search.input.value = normalizeTitle(article.displaytitle);
		this.search.update();
		if (hash) {
			window.location = hash;
		} else {
			window.scrollTo(0, 0);
		}
		this.loadImages();
	};
	
	Page.prototype.filterHTML = function(html) {
		var self = this;
		html = html.replace(/<img[^>]+>/g, function(tag) {
			var attrs = tag.substr(5, tag.length - 6);
			if (attrs.substr(attrs.length - 1, 1) == '/') {
				attrs = attrs.substr(0, attrs.length - 1);
			}
			attrs = attrs.split(/"\s+/);
			var newAttrs = [], attr, style = '';
			newAttrs.push('class="image-placeholder"');
			for (var i = 0; i < attrs.length; i++) {
				attr = attrs[i];
				if (attr.trim() == '') {
					continue;
				}
				if (attr.substr(0, 5) == 'data-') {
					newAttrs.push(attr + '"');
				} else {
					var size = attr.match(/(width|height)="([^"]+)/);
					if (size) {
						style += size[1] + ': ' + size[2] + 'px; ';
					}
					var src = attr.match(/src="([^"]+)/);
					if (src) {
						self.mediaList.push(src[1]);
					}
					newAttrs.push('data-' + attr + '"');
				}
			}
			newAttrs.push('style="' + style + '"');
			return '<div ' + newAttrs.join(' ') + '></div>';
		});
		return html;
	};
	
	Page.prototype.loadImages = function() {
		for (var i = 0; i < $('.image-placeholder').length; i++) {
			var div = $('.image-placeholder')[i];
			var src = div.getAttribute('data-src');
			this.loadImage(div, src);
		}
	};
	
	Page.prototype.loadImage = function(el, src) {
		if (this.loadingImages) {
			if (!this.imageQueue) {
				this.imageQueue = [];
			}
			this.imageQueue.push([el, src]);
		} else {
			var self = this;
			this.loadingImages = true;
			this.indexedDB.get('media', src, function(dataURL) {
				if (dataURL) {
					console.log('Loading ' + src + ' from IndexedDB');
					self.displayImage(el, dataURL);
				} else {
					self.downloadImage(el, src);
				}
			});
		}
	};
		
	Page.prototype.downloadImage = function(el, src) {
		var xhr = new XMLHttpRequest(),
		    blob;
		xhr.open('GET', src, true);
		xhr.responseType = 'blob';
		var self = this;
		xhr.addEventListener('load', function () {
			if (xhr.status === 200) {
				console.log("Image " + src + " downloaded");
				var blob = xhr.response;
				var URL = window.URL || window.webkitURL;
				var dataURL = URL.createObjectURL(blob);
				self.displayImage(el, dataURL);
				self.saveImage(src, blob);
				URL.revokeObjectURL(dataURL);
			}
		}, false);
		xhr.send();
	};
	
	Page.prototype.displayImage = function(el, dataURL) {
		console.log('displayImage', el);
		var img = document.createElement('img');
		img.setAttribute('src', dataURL);
		el.appendChild(img);
		this.loadingImages = false;
		if (this.imageQueue &&
		    this.imageQueue.length > 0) {
			var image = this.imageQueue.shift();
			this.loadImage(image[0], image[1]);
		}
	};
	
	Page.prototype.saveImage = function(src, blob) {
		console.log('saveImage ' + src);
		var fr = new FileReader();
		var self = this;
		fr.onload = function(e) {
			console.log('FileReader onload called');
			self.indexedDB.put('media', e.target.result, src);
			self.indexedDB.get('mediaArticles', src, function(articles) {
				if (articles) {
					articles.push(self.url);
				} else {
					articles = [self.url];
				}
				self.indexedDB.put('mediaArticles', articles, src);
			});
			self.mediaList.push(src);
		};
		fr.readAsDataURL(blob);
	};
	
	Page.prototype.articleURL = function(title) {
		title = title.replace(/\s+/g, '_');
		title = encodeURIComponent(title);
		return 'http://' + this.articleDomain() + '/wiki/' + title;
	};
	
	Page.prototype.articleDomain = function() {
		return $('#domain')[0].innerHTML;
	};
	
	function SearchBox(page) {
		this.input = document.getElementById('input');
		this.form = document.getElementById('form');
		this.clear = document.getElementById('clear');
		this.page = page;
		this.setupEvents();
		this.update();
	}
	
	SearchBox.prototype.setupEvents = function() {
		this.addListener(this.input, 'focus', function() {
			this.focused = true;
			this.input.select();
		});
		this.addListener(this.input, 'blur', function() {
			this.focused = false;
		});
		this.addListener(this.input, 'keydown', function(e) {
			var ignoreKeys = [9, 16, 17, 18, 224, 37, 39];
			if (ignoreKeys.indexOf(e.keyCode) > -1) {
				return true;
			} else if (e.keyCode === 38) {
				this.selectPrevious();
				e.preventDefault();
				return false;
			} else if (e.keyCode === 40) {
				this.selectNext();
				e.preventDefault();
				return false;
			} else if (e.keyCode === 27) {
				this.autoComplete.className = 'hidden';
				this.input.blur();
				return true;
			} else if (e.keyCode === 13) {
				this.page.load(this.input.value);
				if (this.autoComplete) {
					this.autoComplete.className = 'hidden';
				}
				e.preventDefault();
				return false;
			}
			var self = this;
			if (this.keyTimeout) {
				clearTimeout(this.keyTimeout);
			}
			this.keyTimeout = setTimeout(function() {
				self.keyTimeout = null;
				if (self.input.value !== '') {
					self.page.wikipedia.search(self.input.value, function(results) {
						if (results[1].length === 1) {
							self.page.load(results[1][0]);
						} else {
							self.showResults.apply(self, [results]);
						}
					});
				}
			}, 500);
		});
		this.addListener(this.form, 'submit', function(e) {
			e.preventDefault();
			this.page.load(this.input.value);
			return false;
		});
		this.addListener(this.clear, 'click', function(e) {
			e.preventDefault();
			this.input.value = '';
			this.update();
			this.input.focus();
			$('#bodyContent')[0].innerHTML = '';
			return false;
		});
		this.addListener($('#domain')[0], 'click', function(e) {
			var domain = prompt('Search which domain?', $('#domain')[0].innerHTML);
			if (domain) {
				$('#domain')[0].innerHTML = domain;
				this.page.wikipedia.setDomain(domain);
			}
		});
		this.addListener(this.form, 'keypress', this.update);
		this.addListener(window, 'resize', this.update);
	};
	
	SearchBox.prototype.update = function() {
		if (this.input.scrollHeight != this.input.offsetHeight) {
			this.input.style.height = '39px';
			this.input.style.height = this.input.scrollHeight + 'px';
		}
		if (this.autoComplete) {
			this.autoComplete.style.width = this.input.offsetWidth + 'px';
			this.autoComplete.style.top = (this.input.offsetHeight + this.input.offsetTop) + 'px';
			this.autoComplete.style.left = this.input.offsetLeft + 'px';
		}
		if (this.input.value === '') {
			this.clear.className = 'hidden';
			if (this.autoComplete) {
				this.autoComplete.className = 'hidden';
			}
		} else {
			this.clear.className = '';
		}
	};
	
	SearchBox.prototype.showResults = function(results) {
		var titles = results[1];
		var descriptions = results[2];
		var urls = results[3];
		var items = '';
		var href;
		if (titles.length == 0) {
			if (this.autoComplete) {
				this.autoComplete.className = 'hidden';
			}
			return;
		}
		for (var i = 0; i < titles.length; i++) {
			href = urls[i];
			href = href.match(/(\/wiki\/.+$)/)[1];
			items += '<li><a href="' + href + '">' + titles[i] + '</a></li>';
		}
		if (!this.autoComplete) {
			this.autoComplete = document.createElement('ul');
			this.autoComplete.className = 'autocomplete';
			this.input.parentNode.appendChild(this.autoComplete);
		}
		this.selectedIndex = false;
		this.autoComplete.innerHTML = items;
		this.autoComplete.className = 'autocomplete';
		this.update();
	};
	
	SearchBox.prototype.selectNext = function() {
		if (this.selectedIndex === false) {
			this.selectedIndex = 0;
		} else if (this.selectedIndex === $('.autocomplete li').length - 1) {
			this.selectedIndex = 0;
		} else {
			this.selectedIndex++;
		}
		this.updateSelected();
	};
	
	SearchBox.prototype.selectPrevious = function() {
		if (this.selectedIndex === false) {
			this.selectedIndex = $('.autocomplete li').length - 1;
		} else if (this.selectedIndex === 0) {
			this.selectedIndex = $('.autocomplete li').length - 1;
		} else {
			this.selectedIndex--;
		}
		this.updateSelected();
	};
	
	SearchBox.prototype.updateSelected = function() {
		if ($('.autocomplete .selected').length > 0) {
			$('.autocomplete .selected')[0].className = '';
		}
		if ($('.autocomplete li')[this.selectedIndex]) {
			$('.autocomplete li')[this.selectedIndex].className = 'selected';
			var link = $('.autocomplete li a')[this.selectedIndex];
			this.input.value = link.innerHTML.replace(/&amp;/g, '&');
		}
		this.update();
	};
	
	SearchBox.prototype.addListener = function(el, event, handler) {
		var self = this;
		el.addEventListener(event, function(e) {
			handler.apply(self, [e]);
		}, false);
	};
	
	SearchBox.prototype.clickHandler = function(curr) {
		while (curr.nodeName != 'BODY') {
			if (curr.getAttribute('id') == 'input') {
				return;
			}
			curr = curr.parentNode;
		}
		if (this.autoComplete) {
			this.autoComplete.className = 'hidden';
		}
	}
	
	function SavedList(page) {
		this.page = page;
		this.update();
		this.setupLinkListener();
	}
	
	SavedList.prototype.update = function() {
		var articles = [];
		this.page.indexedDB.each('articles', function(article) {
			articles.push(article);
		}, function() {
			articles.sort(function(a, b) {
				var titleA = normalizeTitle(a.displaytitle).toLowerCase();
				var titleB = normalizeTitle(b.displaytitle).toLowerCase();
				if (titleA.substr(0, 1) == '"') {
					titleA = titleA.substr(1);
				}
				if (titleB.substr(0, 1) == '"') {
					titleB = titleB.substr(1);
				}
				if (titleA < titleB) {
					return -1;
				} else {
					return 1;
				}
			});
			var html = '',
			    article, path, deleteLink;
			for (var i = 0; i < articles.length; i++) {
				article = articles[i];
				path = article.url.replace(/http:\/\/[^\/]+/, '');
				deleteLink = '<a href="#delete" class="delete" data-url="' + article.url + '">&times;</a>';
				html += '<li><a href="' + path + '">' + article.displaytitle + '</a>' + deleteLink + '</li>';
			}
			$('#saved ul')[0].innerHTML = html;
			if (articles.length > 0) {
				$('#saved')[0].className = '';
			} else {
				$('#saved')[0].className = 'hidden';
			}
		});
	};
	
	SavedList.prototype.setupLinkListener = function() {
		var self = this;
		$('#saved')[0].addEventListener('click', function(e) {
			if (e.target &&
			    e.target.nodeName === 'A' &&
			    e.target.className === 'delete') {
				e.preventDefault();
				var url = e.target.getAttribute('data-url');
				self.page.indexedDB.get('articles', url, function(article) {
					if (!article) {
						return;
					}
					console.log(article.media);
					self.page.indexedDB.delete('articles', url, function() {
						self.update();
					});
				});
				return false;
			}
			return true;
		}, true);
	};
	
	function Wikipedia(domain) {
		if (!domain) {
			domain = 'en.wikipedia.org';
		}
		this.setDomain(domain);
	}
	
	Wikipedia.prototype.search = function(query, success, failure) {
		// TODO: switch to straight up AJAX in the app version
		jsonp(this.url({
			action: 'opensearch',
			search: query,
			namespace: '0', // '0|4' for Wikipedia: namespace
			redirects: 'resolve'
		}), success, failure);
	};
	
	Wikipedia.prototype.load = function(title, success, failure) {
		// TODO: switch to straight up AJAX in the app version
		jsonp(this.url({
			action: 'mobileview',
			page: title,
			redirect: 'yes',
			sections: 'all',
			prop: 'text|displaytitle'
		}), success, failure);
	};
	
	Wikipedia.prototype.setDomain = function(domain) {
		this.domain = domain;
	};
	
	Wikipedia.prototype.url = function(args) {
		var url = 'https://' + this.domain + '/w/api.php';
		var query = [], value;
		if (args) {
			args.format = 'json';
			url += '?' + urlEncode(args);
		}
		return url;
	};
	
	function AJAX() {
		this.xhr = new XMLHttpRequest();
	}
	
	AJAX.prototype.get = function(url, callback) {
		this.request('GET', url, null, callback);
	};
	
	AJAX.prototype.post = function(url, data, callback) {
		if (typeof data === "object") {
			data = urlEncode(data);
		}
		this.request('POST', url, data, callback);
	};
	
	AJAX.prototype.request = function(method, url, data, callback) {
		this.xhr.onreadystatechange = function() {
			if (this.readyState === 4) {
				callback(this.responseText);
			}
		};
		this.xhr.open(method.toUpperCase(), url, true);
		this.xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
		this.xhr.send(data);
	};
	
	function IndexedDB(dbName, version, setup) {
		this.dbName = dbName;
		this.version = version;
		this.isReady = false;
		this.readyQueue = [];
		var indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.OIndexedDB || window.msIndexedDB;
		var self = this;
		var request = indexedDB.open(dbName, version);
		request.onsuccess = function(e) {
			self.initialize.apply(self, [e, setup]);
		};
		request.onupgradeneeded = function(e) {
			var db = e.target.result;
			setup.apply(self, [db]);
		};
	}
	
	IndexedDB.prototype.initialize = function(e, setup) {
		this.db = e.target.result;
		this.db.onerror = function(e) {
			console.log("Database error: " + e.target.errorCode);
		};
		if (this.db.setVersion) {
			if (this.db.version === this.version) {
				this.ready();
			} else {
				var setVersion = db.setVersion(this.version);
				var self = this;
				setVersion.onsuccess = function(e) {
					var db = e.target.result;
					setup.apply(self, [db]);
					self.ready();
				};
			}
		} else {
			this.ready();
		}
	};
	
	IndexedDB.prototype.add = function(objectStore, value, success, error) {
		if (!this.isReady) {
			this.readyQueue.push(function() {
				this.add(objectStore, value, success, error);
			});
			return;
		}
		var transaction = this.db.transaction([objectStore], 'readwrite');
		transaction.objectStore(objectStore).add(value);
		if (success) {
			transaction.onsuccess = success;
		}
		if (error) {
			transaction.onerror = error;
		}
	};
	
	IndexedDB.prototype.put = function(objectStore, value, key, callback) {
		if (!this.isReady) {
			this.readyQueue.push(function() {
				this.put(objectStore, value, success, error);
			});
			return;
		}
		var transaction = this.db.transaction([objectStore], 'readwrite');
		if (key) {
			console.log('putting data... ', key);
			var put = transaction.objectStore(objectStore).put(value, key);
		} else {
			var put = transaction.objectStore(objectStore).put(value);
		}
		if (callback) {
			put.oncomplete = callback;
		}
	};
	
	IndexedDB.prototype.get = function(objectStore, key, callback) {
		if (!this.isReady) {
			this.readyQueue.push(function() {
				this.get(objectStore, key, success, error);
			});
			return;
		}
		var transaction = this.db.transaction([objectStore]);
		var request = transaction.objectStore(objectStore).get(key);
		request.onsuccess = function(e) {
			callback(request.result);
		};
	};
	
	IndexedDB.prototype.delete = function(objectStore, key, success, error) {
		if (!this.isReady) {
			this.readyQueue.push(function() {
				this.delete(objectStore, key, success, error);
			});
			return;
		}
		var transaction = this.db.transaction([objectStore], 'readwrite');
		var request = transaction.objectStore(objectStore).delete(key);
		if (success) {
			request.onsuccess = success;
		}
		if (error) {
			request.onerror = error;
		}
	};
	
	IndexedDB.prototype.each = function(objectStore, iterator, callback) {
		if (!this.isReady) {
			this.readyQueue.push(function() {
				this.each(objectStore, iterator, callback);
			});
			return;
		}
		var objectStore = this.db.transaction(objectStore).objectStore(objectStore);
		objectStore.openCursor().onsuccess = function(e) {
			var cursor = e.target.result;
			if (cursor) {
				var result = iterator(cursor.value);
				if (result !== false) {
					cursor.continue();
				} else if (callback) {
					callback();
				}
			} else if (callback) {
				callback();
			}
		};
	};
	
	IndexedDB.prototype.ready = function() {
		this.isReady = true;
		for (var i = 0; i < this.readyQueue.length; i++) {
			this.readyQueue.shift().apply(this);
		}
	};
	
	function jsonp(url, success, failure) {
		var timestamp = (new Date).getTime();
		var random = Math.floor(Math.random() * 999999);
		var callbackHook = 'jsonp_' + timestamp + random;
		var sep = url.indexOf('?') < 0 ? '?' : '&';
		url += sep + 'callback=' + callbackHook;
		var script = document.createElement('script');
		script.src = url;
		var timeout = setTimeout(function() {
			if (failure) {
				failure();
			}
			document.body.removeChild(script);
			delete window[callbackHook];
		}, 5000);
		window[callbackHook] = function(data) {
			if (success) {
				success(data);
			}
			clearTimeout(timeout);
			document.body.removeChild(script);
			delete window[callbackHook];
		};
		document.body.appendChild(script);
		return timeout;
	}
	
	function urlEncode(data) {
		var query = [], value;
		for (key in data) {
			key   = encodeURIComponent(key);
			value = encodeURIComponent(data[key]);
			query.push(key + '=' + value);
		}
		return query.join('&');
	}
	
	function titleDecode(url) {
		var matches = url.match(/^\/wiki\/([^#]+)/);
		if (matches) {
			var title = matches[1];
			title = title.replace(/_/g, ' ');
			title = decodeURIComponent(title);
			return title;
		}
		return null;
	}
	
	function hashDecode(url) {
		var matches = url.match(/^\/wiki\/[^#]+(#.+)$/);
		if (matches) {
			return matches[1];
		}
		return null;
	}
	
	function normalizeTitle(text) {
		if (typeof text === 'string') {
			text = text.replace(/&amp;/g, '&', text);
			text = text.replace(/<[^>]+>/g, '', text);
		}
		return text;
	}
	
	var page = new Page();
	window.db = page.indexedDB;
	
})();
