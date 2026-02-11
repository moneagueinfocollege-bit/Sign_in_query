// Add Record Form Handling
document.addEventListener('DOMContentLoaded', () => {
  const addRecordForm = document.getElementById('addRecordForm');
  if (addRecordForm) {
    addRecordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('nameInput').value;
      const employeeID = document.getElementById('employeeIDInput').value;
      const department = document.getElementById('departmentInput').value;
      const status = document.getElementById('statusInput').value;

      if (!name || !employeeID || !department || !status) {
        alert('Please fill in all fields');
        return;
      }

      try {
        const response = await window.electronAPI.addSignInRecord(name, null, employeeID, department, status);
        if (response.success) {
          alert('Record added successfully!');
          addRecordForm.reset();
        } else {
          alert('Error adding record: ' + response.error);
        }
      } catch (error) {
        alert('Error adding record: ' + error);
      }
    });
  }

  // View Records Page Handling
  const viewRecordsTable = document.getElementById('viewRecordsTable');
  const searchForm = document.getElementById('searchForm');
  
  // Add toggle buttons handling
  const staffToggle = document.getElementById('staffToggle');
  const studentsToggle = document.getElementById('studentsToggle');
  let currentView = 'staff'; // Default view

  if (staffToggle && studentsToggle) {
    staffToggle.addEventListener('click', () => {
      if (currentView !== 'staff') {
        currentView = 'staff';
        updateToggleButtons();
        loadRecords();
      }
    });

    studentsToggle.addEventListener('click', () => {
      if (currentView !== 'students') {
        currentView = 'students';
        updateToggleButtons();
        loadRecords();
      }
    });
  }

  function updateToggleButtons() {
    staffToggle.classList.toggle('active', currentView === 'staff');
    studentsToggle.classList.toggle('active', currentView === 'students');
  }
  
  if (searchForm) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await loadRecords();
    });
  }

  async function loadRecords() {
    try {
      const nameFilter = document.getElementById('nameFilter')?.value || '';
      const idFilter = document.getElementById('idFilter')?.value || '';
      const departmentFilter = document.getElementById('departmentFilter')?.value || '';

      const filters = {
        employeeName: nameFilter,
        employeeID: idFilter,
        department: departmentFilter,
        collection: currentView === 'staff' ? 'Employee_logs' : 
                   currentView === 'students' ? 'signin_logs' : 'visitors'
      };

      const response = await window.electronAPI.getSignInRecords(filters);
      
      if (response.success) {
        const tbody = viewRecordsTable.querySelector('tbody');
        tbody.innerHTML = '';
        
        response.records.forEach(record => {
          const row = document.createElement('tr');
          const timestamp = record.signInTime?.toDate() || new Date();
          const statusClass = record.status === 'Signed In' ? 'status-in' : 'status-out';
          
          let displayName, displayId, displayDepartment;
          
          if (currentView === 'staff') {
            displayName = record.employeeName;
            displayId = record.employeeID || record.employeeId;
            displayDepartment = record.department;
            
            row.innerHTML = `
              <td>${timestamp.toLocaleString()}</td>
              <td>${displayName || ''}</td>
              <td>${displayId || ''}</td>
              <td>${displayDepartment || ''}</td>
              <td class="${statusClass}">${record.status || 'Signed In'}</td>
            `;
            
            // Only add double-click event for staff records
            if (displayId) {
              row.style.cursor = 'pointer';
              row.title = 'Double-click to view employee history';
              row.addEventListener('dblclick', () => {
                console.log('Double-clicked employee record:', {
                  employeeId: displayId,
                  employeeName: displayName,
                  department: displayDepartment
                });
                showEmployeeHistory(displayId, displayName, displayDepartment);
              });
            }
          } else if (currentView === 'students') {
            displayName = record.studentName;
            displayId = record.studentID;
            displayDepartment = record.course;
          } else { // visitors
            displayName = record.visitorName;
            displayId = record.visitorId;
            displayDepartment = record.purpose;
          }
          
          if (!row.innerHTML) { // If not already set for staff
            row.innerHTML = `
              <td>${timestamp.toLocaleString()}</td>
              <td>${displayName || ''}</td>
              <td>${displayId || ''}</td>
              <td>${displayDepartment || ''}</td>
              <td class="${statusClass}">${record.status || 'Signed In'}</td>
            `;
          }
          
          tbody.appendChild(row);
        });
      } else {
        alert('Error loading records: ' + response.error);
      }
    } catch (error) {
      alert('Error loading records: ' + error);
    }
  }

  // Load records on page load for view-records.html
  if (viewRecordsTable) {
    loadRecords();
  }

  // Export functionality
  const exportPdfBtn = document.getElementById('exportPdf');
  const exportCsvBtn = document.getElementById('exportCsv');

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      const doc = new window.jspdf.jsPDF();
      
      // Add title
      doc.setFontSize(16);
      doc.text('Sign-In Records', 14, 15);
      
      // Get table data
      const headers = Array.from(viewRecordsTable.querySelectorAll('thead th')).map(th => th.textContent);
      const rows = Array.from(viewRecordsTable.querySelectorAll('tbody tr')).map(tr => 
        Array.from(tr.querySelectorAll('td')).map(td => td.textContent)
      );
      
      // Add table
      doc.autoTable({
        head: [headers],
        body: rows,
        startY: 25,
        styles: {
          fontSize: 8
        },
        columnStyles: {
          3: { // Status column
            fontStyle: 'bold'
          }
        }
      });
      
      // Save PDF
      doc.save('sign-in-records.pdf');
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      // Get table data
      const headers = Array.from(viewRecordsTable.querySelectorAll('thead th')).map(th => th.textContent);
      const rows = Array.from(viewRecordsTable.querySelectorAll('tbody tr')).map(tr => 
        Array.from(tr.querySelectorAll('td')).map(td => td.textContent)
      );
      
      // Convert to CSV
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');
      
      // Create and trigger download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'sign-in-records.csv';
      link.click();
    });
  }
}); 