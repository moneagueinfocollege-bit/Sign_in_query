const { contextBridge, ipcRenderer } = require('electron');

// Import the required modules
const firebase = require('./firebase-config.js');
const { cacheManager } = require('./cache-utils.js');

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld(
  'electronAPI',
  {
    addSignInRecord: async (name, timestamp, employeeID, department, profilePhoto, qrIdentifier) => {
      try {
        return await firebase.addSignInRecord(name, timestamp, employeeID, department, profilePhoto, qrIdentifier);
      } catch (error) {
        console.error('Error in addSignInRecord:', error);
        return { success: false, error: error.message };
      }
    },
    getSignInRecords: async (filters) => {
      try {
        return await firebase.getSignInRecords(filters);
      } catch (error) {
        console.error('Error in getSignInRecords:', error);
        return { success: false, error: error.message };
      }
    },
    getCollectionDataForDateRange: async (collection, startDate, endDate) => {
      try {
        return await firebase.getCollectionDataForDateRange(collection, startDate, endDate);
      } catch (error) {
        console.error('Error in getCollectionDataForDateRange:', error);
        return { success: false, error: error.message };
      }
    },
    getEmployeeRecords: async (employeeID, startDate, endDate) => {
      try {
        return await firebase.getEmployeeRecords(employeeID, startDate, endDate);
      } catch (error) {
        console.error('Error in getEmployeeRecords:', error);
        return { success: false, error: error.message };
      }
    },
    getIdentifier: async (employeeID) => {
      try {
        return await firebase.getIdentifier(employeeID);
      } catch (error) {
        console.error('Error in getIdentifier:', error);
        return { success: false, error: error.message };
      }
    },
    getVisitorRecords: async (filters) => {
      try {
        return await firebase.getVisitorRecords(filters);
      } catch (error) {
        console.error('Error in getVisitorRecords:', error);
        return { success: false, error: error.message };
      }
    },
    performSync: async () => {
      try {
        const collections = ['Employee_logs', 'signin_logs', 'visitors'];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const results = await Promise.all(collections.map(async collection => {
          const result = await firebase.getCollectionDataForDateRange(
            collection,
            thirtyDaysAgo,
            new Date()
          );
          return { collection, result };
        }));

        const success = results.every(r => r.result.success);
        return { 
          success,
          results: results.map(r => ({
            collection: r.collection,
            success: r.result.success,
            recordCount: r.result.data?.length || 0
          }))
        };
      } catch (error) {
        console.error('Error in performSync:', error);
        return { success: false, error: error.message };
      }
    },
    // Expose the cache manager
    cacheManager: {
      init: async () => {
        try {
          return await cacheManager.init();
        } catch (error) {
          console.error('Error initializing cache:', error);
          throw error;
        }
      },
      setCache: async (key, data, ttl) => {
        try {
          return await cacheManager.setCache(key, data, ttl);
        } catch (error) {
          console.error('Error setting cache:', error);
          throw error;
        }
      },
      getCache: async (key) => {
        try {
          return await cacheManager.getCache(key);
        } catch (error) {
          console.error('Error getting cache:', error);
          throw error;
        }
      }
    },
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates')
  }
); 