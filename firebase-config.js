const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, Query, where, orderBy, limit, startAfter, collection, query } = require('firebase-admin/firestore');
const serviceAccount = require('./firestore-key.json');
const { cacheManager, rateLimiter } = require('./cache-utils');

//# sourceMappingURL=firestore_admin_client.js.map

const app = initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore(app);

// Constants for query optimization
const RECORDS_PER_PAGE = 50;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Function to check and update records for forced sign-outs
async function checkAndUpdateForcedSignOuts() {
  try {
    // Get yesterday's end time (23:59:59.999)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);
    
    // Collections to check
    const collections = ['Employee_logs', 'signin_logs'];
    
    for (const collectionName of collections) {
      try {
        // Get all records from the collection
        const snapshot = await db.collection(collectionName).get();
        
        if (!snapshot.empty) {
          // Process records in batches of 500 (Firestore limit)
          const batches = [];
          let currentBatch = db.batch();
          let operationCount = 0;
          let updatedCount = 0;
          
          for (const doc of snapshot.docs) {
            const data = doc.data();
            
            // Check if record needs forced sign-out
            if (data.status === 'Signed In' || data.status === 'Temporarily Signed Out') {
              const signInTime = data.signInTime.toDate();
              const tempOutTime = data.temporarySignOutTime ? data.temporarySignOutTime.toDate() : null;
              
              // If sign-in was before yesterday's end and still not properly signed out
              if (signInTime < yesterday) {
                // If current batch is full, create a new one
                if (operationCount >= 500) {
                  batches.push(currentBatch);
                  currentBatch = db.batch();
                  operationCount = 0;
                }
                
                const endOfSignInDay = new Date(signInTime);
                endOfSignInDay.setHours(23, 59, 59, 999);
                
                // Prepare update data
                const updateData = {
                  status: 'Forced Sign-out',
                  signOutTime: Timestamp.fromDate(endOfSignInDay),
                  forcedSignOut: true,
                  lastUpdated: Timestamp.now()
                };

                // Add appropriate reason based on status
                if (data.status === 'Temporarily Signed Out') {
                  updateData.forcedSignOutReason = 'Day ended during temporary sign-out';
                  // Keep the temporary sign-out time for record keeping
                  if (tempOutTime) {
                    updateData.temporarySignOutTime = data.temporarySignOutTime;
                  }
                } else {
                  updateData.forcedSignOutReason = 'Day ended without sign-out';
                }

                // Update the record
                currentBatch.update(doc.ref, updateData);
                
                operationCount++;
                updatedCount++;
              }
            }
          }
          
          // Add the last batch if it has operations
          if (operationCount > 0) {
            batches.push(currentBatch);
          }
          
          // Execute all batches in parallel
          if (batches.length > 0) {
            await Promise.all(batches.map(batch => batch.commit()));
            console.log(`Updated ${updatedCount} records in ${collectionName} with forced sign-outs`);
            
            // Clear any cached data for this collection
            const cacheKey = `${collectionName}_`;
            await cacheManager.clearCacheByPrefix(cacheKey);
          }
        }
      } catch (error) {
        console.error(`Error processing collection ${collectionName}:`, error);
        // Continue with next collection even if one fails
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error in checkAndUpdateForcedSignOuts:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to build optimized queries
function buildOptimizedQuery(collectionName, filters = {}) {
    let query = db.collection(collectionName);
    
    // Add date range filter if provided
    if (filters.startDate && filters.endDate) {
        const startTimestamp = Timestamp.fromDate(new Date(filters.startDate));
        const endTimestamp = Timestamp.fromDate(new Date(filters.endDate));
        query = query.where('signInTime', '>=', startTimestamp)
                    .where('signInTime', '<=', endTimestamp);
    }

    // Add name filter if provided
    if (filters.name) {
        query = query.where('employeeName', '>=', filters.name)
                    .where('employeeName', '<=', filters.name + '\uf8ff');
    }

    // Add ID filter if provided
    if (filters.id) {
        query = query.where('employeeID', '==', filters.id);
    }

    // Add department filter if provided
    if (filters.department) {
        query = query.where('department', '==', filters.department);
    }

    // Add ordering and limit
    query = query.orderBy('signInTime', 'desc')
                .limit(RECORDS_PER_PAGE);

    return query;
}

async function addSignInRecord(name, timestamp, employeeId, department, profilePhotoId, qrIdentifier) {
  try {
    if (!qrIdentifier) {
      return { success: false, error: 'QR Identifier is required' };
    }

    if (!employeeId) {
      return { success: false, error: 'ID Number is required' };
    }

    // Save in Identifiers collection using QR Identifier as document ID
    const identifierRef = db.collection('Identifiers').doc(qrIdentifier);
    await identifierRef.set({
      Name: name,
      Department: department,
      'ID Number': employeeId,
      'Shareable Link': profilePhotoId || ''
    }, { merge: true }); // Use merge to update existing documents

    // Save in IdNumber collection using ID Number as document ID
    const idNumberRef = db.collection('IdNumber').doc(employeeId);
    await idNumberRef.set({
      Name: name,
      Department: department,
      'ID Number': employeeId,
      'Identifier': qrIdentifier,
      'Shareable Link': profilePhotoId || ''
    }, { merge: true }); // Use merge to update existing documents

    // Determine the appropriate collection based on department
    let collectionName;
    if (department === 'Students') {
      collectionName = 'signin_logs';
    } else if (department === 'Visitors') {
      collectionName = 'visitors';
    } else {
      collectionName = 'Employee_logs';
    }

    // Create the sign-in record with current timestamp
    const signInTime = timestamp || Timestamp.now();
    const recordData = {
      name: name,
      employeeName: name, // For compatibility with existing queries
      employeeId: employeeId,
      employeeID: employeeId, // For compatibility with existing queries
      department: department,
      signInTime: signInTime,
      status: 'Signed In',
      qrIdentifier: qrIdentifier,
      profilePhotoId: profilePhotoId || ''
    };

    // Save the actual sign-in record
    await db.collection(collectionName).add(recordData);
    
    return { success: true };
  } catch (error) {
    console.error('Error adding record:', error);
    return { success: false, error: error.message };
  }
}

async function getIdentifier(qrIdentifier) {
  try {
    // Use the correct collection name with capital I and only fetch required fields
    const docRef = await db.collection('Identifiers').doc(qrIdentifier).get({
      select: ['Name', 'Department', 'ID Number', 'Shareable Link']
    });
    
    if (docRef.exists) {
      const data = docRef.data();
      return { 
        success: true, 
        data: {
          Name: data.Name,
          Department: data.Department,
          IdNumber: data['ID Number'],
          ProfilePhotoId: data['Shareable Link']
        }
      };
    } else {
      return { success: false, error: 'Identifier not found' };
    }
  } catch (error) {
    console.error('Error getting identifier:', error);
    return { success: false, error: error.message };
  }
}

// Add this helper function for time calculations
function calculateWorkingHours(record) {
  try {
    let totalMinutes = 0;
    let mainWorkingMinutes = 0;
    let temporaryBreakMinutes = 0;

    // Convert Firestore timestamps to JavaScript Date objects
    const signInTime = record.signInTime?.toDate() || null;
    const signOutTime = record.signOutTime?.toDate() || null;
    const tempOutTime = record.temporarySignOutTime?.toDate() || null;
    const secondSignInTime = record.secondSignInTime?.toDate() || null;

    if (!signInTime) return { totalHours: 0, status: 'Invalid sign-in' };

    // Calculate main working period
    if (signOutTime) {
      mainWorkingMinutes = (signOutTime - signInTime) / (1000 * 60);
    } else {
      // If no sign out, consider them still working
      mainWorkingMinutes = (new Date() - signInTime) / (1000 * 60);
    }

    // Calculate temporary break period
    if (tempOutTime && secondSignInTime) {
      temporaryBreakMinutes = (secondSignInTime - tempOutTime) / (1000 * 60);
    }

    // If temporary break is less than or equal to 60 minutes (1 hour), include it in working time
    if (temporaryBreakMinutes <= 60) {
      totalMinutes = mainWorkingMinutes;
    } else {
      // Subtract the excess break time beyond 1 hour
      totalMinutes = mainWorkingMinutes - (temporaryBreakMinutes - 60);
    }

    // Convert to hours with 2 decimal places
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

    return {
      totalHours,
      status: signOutTime ? 'Completed' : 'In Progress',
      breakDuration: Math.round(temporaryBreakMinutes),
      expectedHours: 8
    };
  } catch (error) {
    console.error('Error calculating working hours:', error);
    return { totalHours: 0, status: 'Calculation error' };
  }
}

// Function to get records with optimized query
async function getSignInRecords(filters = {}) {
    try {
        const collectionName = filters.collection || 'Employee_logs';
        const cacheKey = `${collectionName}_${JSON.stringify(filters)}`;
        
        // Check cache first
        const cachedData = await cacheManager.getCache(cacheKey);
        if (cachedData) {
            return { success: true, records: cachedData };
        }

        // Build and execute optimized query
        const query = buildOptimizedQuery(collectionName, filters);
        const querySnapshot = await query.get();
        
        const records = [];
        querySnapshot.forEach((doc) => {
            records.push({ id: doc.id, ...doc.data() });
        });

        // Cache the results
        await cacheManager.setCache(cacheKey, records, CACHE_DURATION);
        
        return { success: true, records };
    } catch (error) {
        console.error('Error getting records:', error);
        return { success: false, error: error.message };
    }
}

async function getEmployeeRecords(employeeId, startDate = null, endDate = null) {
  try {
    console.log('getEmployeeRecords called with:', { employeeId, startDate, endDate });

    // Create base query with employeeId filter - now using Employee_logs collection
    let query = db.collection('Employee_logs')
                  .where('employeeId', '==', employeeId);

    // Add date range filters if provided
    if (startDate && endDate) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(0, 0, 0, 0);
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      
      query = query.where('signInTime', '>=', Timestamp.fromDate(startDateTime))
                  .where('signInTime', '<=', Timestamp.fromDate(endDateTime));
    } else if (startDate) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(0, 0, 0, 0);
      query = query.where('signInTime', '>=', Timestamp.fromDate(startDateTime));
    } else if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.where('signInTime', '<=', Timestamp.fromDate(endDateTime));
    }

    // Add orderBy and limit
    query = query.orderBy('signInTime', 'desc').limit(50);

    // Get the records
    const snapshot = await query.get();

    const records = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Calculate working hours for each record
      const workingHours = calculateWorkingHours(data);
      
      records.push({
        id: doc.id,
        ...data,
        workingHours: workingHours.totalHours,
        workStatus: workingHours.status,
        breakDuration: workingHours.breakDuration,
        expectedHours: workingHours.expectedHours,
        hasComment: !!data.comment
      });
    });

    return { success: true, records };
  } catch (error) {
    console.error('Detailed error in getEmployeeRecords:', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    
    if (error.code === 'failed-precondition') {
      console.error('This query requires a composite index. Please create an index for employeeId and signInTime fields.');
    }
    return { success: false, error };
  }
}

async function getVisitorRecords(filters = {}) {
  try {
    let query = db.collection('visitors');

    // Apply filters if they exist and are not empty
    if (filters.name) {
      query = query.where('name', '>=', filters.name)
                  .where('name', '<=', filters.name + '\uf8ff');
    }
    if (filters.purpose) {
      query = query.where('purpose', '>=', filters.purpose)
                  .where('purpose', '<=', filters.purpose + '\uf8ff');
    }
    if (filters.startDate && filters.endDate) {
      query = query.where('signInTime', '>=', Timestamp.fromDate(filters.startDate))
                  .where('signInTime', '<=', Timestamp.fromDate(filters.endDate));
    }

    // Always order by signInTime desc and limit to 50 records
    query = query.orderBy('signInTime', 'desc').limit(50);
    
    // Only select the fields we need
    const snapshot = await query.select(
      'name',
      'signInTime',
      'expectedTime',
      'purpose',
      'photo'
    ).get();
    
    const records = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      records.push({ 
        id: doc.id,
        name: data.name || '',
        signInTime: data.signInTime,
        expectedTime: data.expectedTime,
        purpose: data.purpose || '',
        photo: data.photo || ''
      });
    });
    return { success: true, records };
  } catch (error) {
    console.error('Error getting visitor records:', error);
    return { success: false, error };
  }
}

// Function to get records for a specific date range
async function getCollectionDataForDateRange(collectionName, startDate, endDate) {
    try {
        const cacheKey = `${collectionName}_${startDate.toISOString()}_${endDate.toISOString()}`;
        
        // Check cache first
        const cachedData = await cacheManager.getCache(cacheKey);
        if (cachedData) {
            return { success: true, data: cachedData };
        }

        // Build optimized query for date range
        const query = buildOptimizedQuery(collectionName, { startDate, endDate });
        const querySnapshot = await query.get();
        
        const records = [];
        querySnapshot.forEach((doc) => {
            records.push({ id: doc.id, ...doc.data() });
        });

        // Cache the results
        await cacheManager.setCache(cacheKey, records, CACHE_DURATION);
        
        return { success: true, data: records };
    } catch (error) {
        console.error('Error getting collection data:', error);
        return { success: false, error: error.message };
    }
}

// Optimized batch operations
async function batchOperation(operations) {
  const batches = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const op of operations) {
    if (operationCount >= 500) { // Firestore limit is 500 operations per batch
      batches.push(currentBatch);
      currentBatch = db.batch();
      operationCount = 0;
    }

    const { type, ref, data } = op;
    switch (type) {
      case 'set':
        currentBatch.set(ref, data);
        break;
      case 'update':
        currentBatch.update(ref, data);
        break;
      case 'delete':
        currentBatch.delete(ref);
        break;
    }
    operationCount++;
  }

  if (operationCount > 0) {
    batches.push(currentBatch);
  }

  // Execute all batches in parallel
  await Promise.all(batches.map(batch => batch.commit()));
}

module.exports = {
  addSignInRecord,
  getSignInRecords,
  getEmployeeRecords,
  getVisitorRecords,
  getIdentifier,
  getCollectionDataForDateRange,
  batchOperation,
  checkAndUpdateForcedSignOuts,
}; 