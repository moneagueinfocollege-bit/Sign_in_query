const { deflate, inflate } = require('pako');

class CacheManager {
  constructor() {
    this.memoryCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.maxCacheSize = 50 * 1024 * 1024; // 50MB
    this.currentCacheSize = 0;
    this.db = null;
    this.dbName = 'SignInAppCache';
  }

  async clearCacheByPrefix(prefix) {
    // Clear memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }
    
    // Clear IndexedDB cache if available
    try {
      const request = indexedDB.open('FirestoreCache', 1);
      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['cache'], 'readwrite');
        const objectStore = transaction.objectStore('cache');
        
        const request = objectStore.openCursor();
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            if (cursor.key.startsWith(prefix)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      };
    } catch (error) {
      console.error('Error clearing IndexedDB cache:', error);
    }
  }

  // Initialize the database
  async init() {
    if (this.db) {
      return Promise.resolve();
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    console.log('Initializing IndexedDB...');
    
    this.initPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.error('IndexedDB is not available');
        return reject(new Error('IndexedDB is not available'));
      }

      // Delete the existing database to ensure clean initialization
      const deleteRequest = window.indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onerror = () => {
        console.warn('Error deleting database:', deleteRequest.error);
        // Continue with opening the database even if deletion fails
        this.openDatabase(resolve, reject);
      };

      deleteRequest.onsuccess = () => {
        console.log('Successfully deleted old database');
        this.openDatabase(resolve, reject);
      };

      deleteRequest.onblocked = () => {
        console.warn('Database deletion was blocked');
        this.openDatabase(resolve, reject);
      };
    });

    return this.initPromise;
  }

  openDatabase(resolve, reject) {
    try {
      console.log('Opening database...');
      const request = window.indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('Database error:', event.target.error);
        reject(event.target.error);
      };

      request.onupgradeneeded = (event) => {
        console.log('Upgrading database...');
        const db = event.target.result;
        
        // Create the object store
        if (!db.objectStoreNames.contains(this.storeName)) {
          console.log('Creating object store:', this.storeName);
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event) => {
        console.log('Database opened successfully');
        this.db = event.target.result;

        this.db.onerror = (event) => {
          console.error('Database error:', event.target.error);
        };

        this.db.onversionchange = () => {
          this.db.close();
          console.log('Database is outdated, please reload the page.');
        };

        resolve();
      };
    } catch (error) {
      console.error('Error opening database:', error);
      reject(error);
    }
  }

  // Compress data using pako
  compressData(data) {
    const jsonString = JSON.stringify(data);
    const compressed = deflate(jsonString);
    return compressed;
  }

  // Decompress data
  decompressData(compressed) {
    const decompressed = inflate(compressed, { to: 'string' });
    return JSON.parse(decompressed);
  }

  // Store data in cache with compression
  async setCache(key, data, ttl = this.cacheTimeout) {
    try {
      await this.init();

      // Compress the data
      const compressed = this.compressData(data);
      const size = compressed.length;

      // Check if adding this would exceed cache size
      if (this.currentCacheSize + size > this.maxCacheSize) {
        this.evictOldEntries(size);
      }

      const cacheEntry = {
        data: compressed,
        timestamp: Date.now(),
        ttl,
        size
      };

      this.memoryCache.set(key, cacheEntry);
      this.currentCacheSize += size;

      // Store in IndexedDB for persistence
      await this.storeInIndexedDB(key, cacheEntry);

      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  // Retrieve and decompress data from cache
  async getCache(key) {
    try {
      // Try memory cache first
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry) {
        if (Date.now() - memoryEntry.timestamp < memoryEntry.ttl) {
          return this.decompressData(memoryEntry.data);
        }
        // Remove expired entry
        this.memoryCache.delete(key);
        this.currentCacheSize -= memoryEntry.size;
      }

      // Try IndexedDB if not in memory
      const idbEntry = await this.getFromIndexedDB(key);
      if (idbEntry && (Date.now() - idbEntry.timestamp < idbEntry.ttl)) {
        // Add back to memory cache
        this.memoryCache.set(key, idbEntry);
        this.currentCacheSize += idbEntry.size;
        return this.decompressData(idbEntry.data);
      }

      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  // Store in IndexedDB for persistence
  async storeInIndexedDB(key, entry) {
    return new Promise((resolve, reject) => {
      try {
        // Normalize the data structure to match Firestore
        if (entry && typeof entry === 'object') {
          // Handle single record
          if (!Array.isArray(entry)) {
            this.normalizeRecord(entry);
          } 
          // Handle array of records
          else {
            entry.forEach(record => {
              if (record && typeof record === 'object') {
                this.normalizeRecord(record);
              }
            });
          }
        }

        const request = window.indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = () => {
          console.error('Error opening database:', request.error);
          reject(request.error);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          try {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.put(entry, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          } catch (error) {
            console.error('Error in transaction:', error);
            reject(error);
          }
        };
      } catch (error) {
        console.error('Error in storeInIndexedDB:', error);
        reject(error);
      }
    });
  }

  // Helper method to normalize record fields
  normalizeRecord(record) {
    // Employee ID normalization - use lowercase 'd' to match Firestore
    if (!record.employeeId) {
      record.employeeId = record.employeeID || record.employeeid || record['ID Number'];
    }
    // Keep employeeID for backward compatibility
    record.employeeID = record.employeeId;

    // Name normalization
    if (!record.employeeName) {
      record.employeeName = record.name || record.Name;
    }
    record.name = record.employeeName;

    // Department normalization
    if (!record.department) {
      record.department = record.Department;
    }
    record.Department = record.department;

    // Status normalization
    if (!record.status) {
      record.status = 'Signed In';
    }

    // Ensure timestamps are properly formatted
    ['signInTime', 'signOutTime', 'temporarySignOutTime', 'secondSignInTime'].forEach(timeField => {
      if (record[timeField]) {
        if (typeof record[timeField] === 'string') {
          record[timeField] = {
            _seconds: Math.floor(new Date(record[timeField]).getTime() / 1000),
            _nanoseconds: 0
          };
        }
      }
    });

    return record;
  }

  // Retrieve from IndexedDB
  async getFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
      try {
        const request = window.indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = () => {
          console.error('Error opening database:', request.error);
          reject(request.error);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          try {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const getRequest = store.get(key);

            getRequest.onsuccess = () => {
              const result = getRequest.result;
              // Normalize the data structure
              if (result) {
                if (Array.isArray(result)) {
                  result.forEach(record => {
                    if (record && typeof record === 'object') {
                      this.normalizeRecord(record);
                    }
                  });
                } else if (typeof result === 'object') {
                  this.normalizeRecord(result);
                }
              }
              resolve(result);
            };

            getRequest.onerror = () => reject(getRequest.error);
          } catch (error) {
            console.error('Error in transaction:', error);
            reject(error);
          }
        };
      } catch (error) {
        console.error('Error in getFromIndexedDB:', error);
        reject(error);
      }
    });
  }

  // Evict old entries to make space
  evictOldEntries(requiredSpace) {
    const entries = Array.from(this.memoryCache.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    while (this.currentCacheSize + requiredSpace > this.maxCacheSize && entries.length) {
      const [key, entry] = entries.shift();
      this.memoryCache.delete(key);
      this.currentCacheSize -= entry.size;
    }
  }

  // Clear expired entries
  clearExpired() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        this.currentCacheSize -= entry.size;
      }
    }
  }
}

// Rate limiting utility
class RateLimiter {
  constructor(maxRequests = 100, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = new Map();
  }

  async checkLimit(key) {
    const now = Date.now();
    const userRequests = this.requests.get(key) || [];
    
    // Remove old requests outside the time window
    const validRequests = userRequests.filter(time => now - time < this.timeWindow);
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(key, validRequests);
    return true;
  }

  async waitForAvailable(key) {
    while (!(await this.checkLimit(key))) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return true;
  }
}

module.exports = {
  cacheManager: new CacheManager(),
  rateLimiter: new RateLimiter()
}; 