// script.js
(() => {
  // ——— Helpers & Storage ———
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'paytrack';
  let data = { methods: [], entries: [] };

  // XSS Prevention Helper
  function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
  }

  function loadData() {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) data = JSON.parse(s);
  }
  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ——— UUID v4 ———
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // ——— Date / Month ———
  let current = new Date();
  
  // FIX: Use local time instead of UTC to prevent timezone data shifting
  const monthKey = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };
  
  const formatMonth = d =>
    d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ——— Versioned lookups ———
  function getVersioned(map = {}, fallback, month) {
    const ks = Object.keys(map).filter(k => k <= month).sort();
    return ks.length ? map[ks.pop()] : fallback;
  }
  const getMethodName = (m, month) => getVersioned(m.names, m.name, month);
  const getAssignment = (e, month) =>
    getVersioned(e.assignments, data.methods[0]?.id || null, month);
  const getOrder = (e, month) => +getVersioned(e.order, 0, month);

  // ——— Sortable refs ———
  let methodSortable = null,
      entrySortables = [];

  // ——— Render everything ———
  function renderAll() {
    const mon = monthKey(current);
    const today = new Date().getDate();
    const currentYear = current.getFullYear();
    const currentMonthIndex = current.getMonth();
    const daysInCurrentMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();

    $('currentMonth').textContent = formatMonth(current);

    const c = $('methodsContainer');
    c.innerHTML = '';

    if (!data.methods.length) {
      $('addEntryBtn').disabled = true;
      c.innerHTML = `
        <div class="alert alert-info text-center">
          No payment methods yet.<br>
          Click <strong>Add Payment Method</strong> to get started!
        </div>`;
      ['totalAmount', 'paidAmount', 'dueAmount'].forEach(id => $(id).textContent = 'RM 0.00');
      methodSortable?.destroy();
      entrySortables.forEach(s => s.destroy());
      return;
    }
    
    $('addEntryBtn').disabled = false;

    let grandTotal = 0, grandPaid = 0;

    data.methods.forEach(m => {
      // filter & sort entries for this method (excluding deleted ones because m.id won't match "DELETED")
      const items = data.entries
        .filter(e => getAssignment(e, mon) === m.id)
        .sort((a, b) => getOrder(a, mon) - getOrder(b, mon));

      // compute subtotals
      let subTotal = 0, subPaid = 0;
      items.forEach(i => {
        subTotal += i.amount;
        if (i.paid?.[mon]) subPaid += i.amount;
      });
      const subDue = subTotal - subPaid;
      grandTotal += subTotal;
      grandPaid += subPaid;

      // build card
      const card = document.createElement('div');
      card.className = 'card mb-3';
      card.dataset.methodId = m.id;
      
      card.innerHTML = `
        <div class="card-header">
          <div class="row align-items-center">
            <div class="col-auto pe-2">
              <span class="drag-handle-method" style="cursor:grab; font-size:1.2rem;">≡</span>
            </div>
            <div class="col-12 col-md-auto">
              <strong>${escapeHTML(getMethodName(m, mon))}</strong>
            </div>
            <div class="col-12 col-md my-2 my-md-0 method-totals">
              <span class="me-3">Due : RM ${subDue.toFixed(2)}</span>
                <br>
              <span class="me-3">Paid : RM ${subPaid.toFixed(2)}</span>
                <br>
              <span>Total : RM ${subTotal.toFixed(2)}</span>
            </div>
            <div class="col-12 col-md-auto text-md-end">
              <button class="btn btn-sm btn-outline-secondary edit-method">Edit</button>
              <button class="btn btn-sm btn-outline-danger delete-method">Delete</button>
            </div>
          </div>
        </div>
        <ul class="list-group list-group-flush"></ul>
      `;
      c.append(card);

      // method handlers
      card.querySelector('.edit-method').onclick = () => openMethodModal(m.id);
      card.querySelector('.delete-method').onclick = () => deleteMethod(m.id);

      // fill entries
      const ul = card.querySelector('ul');
      if (items.length) {
        items.forEach(i => {
          const li = document.createElement('li');
          li.className = 'list-group-item d-flex justify-content-between align-items-center';
          li.dataset.entryId = i.id;

          const isPaid = Boolean(i.paid?.[mon]);
          
          // FIX: Smart due day logic for months with 28/30 days
          const effectiveDueDay = Math.min(i.dueDay, daysInCurrentMonth);
          if (!isPaid && today >= effectiveDueDay) {
            li.classList.add('list-group-item-danger');
          }

          // left: handle + checkbox + text
          const left = document.createElement('div');
          left.className = 'd-flex align-items-center';

          const h2 = document.createElement('span');
          h2.className = 'drag-handle-entry me-2';
          h2.style.cursor = 'grab';
          h2.textContent = '≡';
          left.append(h2);

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'form-check-input me-2';
          cb.checked = isPaid;
          cb.onchange = () => togglePaid(i.id);
          left.append(cb);

          const txt = document.createElement('span');
          txt.textContent = i.item; // XSS safe text content
          if (isPaid) txt.classList.add('text-decoration-line-through');
          left.append(txt);

          li.append(left);

          // right: due badge + amount + buttons
          const right = document.createElement('div');
          right.className = 'd-flex align-items-center';

          const due = document.createElement('span');
          due.className = 'badge bg-light text-dark me-3';
          due.textContent = `Due on ${i.dueDay}`;
          right.append(due);

          const amt = document.createElement('span');
          amt.textContent = `RM ${i.amount.toFixed(2)}`;
          right.append(amt);

          const eBtn = document.createElement('button');
          eBtn.className = 'btn btn-sm btn-outline-secondary ms-2 me-1';
          eBtn.title = 'Edit';
          eBtn.innerHTML = '<i class="bi bi-pencil"></i><span class="d-none d-md-inline"> Edit</span>';
          eBtn.onclick = () => openEntryModal(i.id);
          right.append(eBtn);

          const dBtn = document.createElement('button');
          dBtn.className = 'btn btn-sm btn-outline-danger';
          dBtn.title = 'Delete';
          dBtn.innerHTML = '<i class="bi bi-trash"></i><span class="d-none d-md-inline"> Delete</span>';
          dBtn.onclick = () => deleteEntry(i.id);
          right.append(dBtn);

          li.append(right);
          ul.append(li);
        });
      } else {
        ul.innerHTML = `<li class="list-group-item text-muted">No entries added</li>`;
      }
    });

    // footer totals
    $('totalAmount').textContent = `RM ${grandTotal.toFixed(2)}`;
    $('paidAmount').textContent = `RM ${grandPaid.toFixed(2)}`;
    $('dueAmount').textContent = `RM ${(grandTotal - grandPaid).toFixed(2)}`;

    // Rebuild entry-method dropdown safely (XSS protection)
    const methodSelect = $('entryMethod');
    methodSelect.innerHTML = '';
    data.methods.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = getMethodName(m, mon);
      methodSelect.appendChild(opt);
    });

    // destroy old sortables
    methodSortable?.destroy();
    entrySortables.forEach(s => s.destroy());
    entrySortables = [];

    // re-init method drag-and-drop
    methodSortable = Sortable.create(c, {
      animation: 150,
      handle: '.drag-handle-method',
      onEnd: () => {
        const ids = [...c.children].map(ch => ch.dataset.methodId);
        data.methods = ids.map(id => data.methods.find(m => m.id === id));
        saveData();
        renderAll();
      }
    });

    // re-init entry drag-and-drop
    c.querySelectorAll('ul').forEach(ul => {
      const s = Sortable.create(ul, {
        animation: 150,
        handle: '.drag-handle-entry',
        onEnd: () => {
          const mon2 = monthKey(current);
          [...ul.children].forEach((li, idx) => {
            const e = data.entries.find(x => x.id === li.dataset.entryId);
            e.order = e.order || {};
            e.order[mon2] = idx;
          });
          saveData();
        }
      });
      entrySortables.push(s);
    });
  }

  // ——— Toggle Paid (Optimized) ———
  function togglePaid(id) {
    const mon = monthKey(current);
    const e = data.entries.find(x => x.id === id);
    e.paid = e.paid || {};
    e.paid[mon] = !e.paid[mon];
    saveData();

    // Update only the checked item's UI instead of full re-render
    const li = document.querySelector(`li[data-entry-id="${id}"]`);
    if (li) {
      const isPaid = e.paid[mon];
      const textSpan = li.querySelector('div.d-flex.align-items-center > span:last-child');
      
      if (isPaid) {
        textSpan.classList.add('text-decoration-line-through');
        li.classList.remove('list-group-item-danger');
      } else {
        textSpan.classList.remove('text-decoration-line-through');
        
        const today = new Date().getDate();
        const currentYear = current.getFullYear();
        const currentMonthIndex = current.getMonth();
        const daysInCurrentMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
        const effectiveDueDay = Math.min(e.dueDay, daysInCurrentMonth);

        if (today >= effectiveDueDay) li.classList.add('list-group-item-danger');
      }
    }

    updateTotals(mon);
  }

  // ——— Helper: Update Totals Without Full Re-render ———
  function updateTotals(mon) {
    let grandTotal = 0, grandPaid = 0;
    
    data.methods.forEach(m => {
      const items = data.entries.filter(e => getAssignment(e, mon) === m.id);
      let subTotal = 0, subPaid = 0;
      
      items.forEach(i => {
        subTotal += i.amount;
        if (i.paid?.[mon]) subPaid += i.amount;
      });
      
      grandTotal += subTotal;
      grandPaid += subPaid;
      
      const card = document.querySelector(`.card[data-method-id="${m.id}"]`);
      if (card) {
        const subDue = subTotal - subPaid;
        const totalsDiv = card.querySelector('.method-totals');
        if (totalsDiv) {
          totalsDiv.innerHTML = `
            <span class="me-3">Due : RM ${subDue.toFixed(2)}</span><br>
            <span class="me-3">Paid : RM ${subPaid.toFixed(2)}</span><br>
            <span>Total : RM ${subTotal.toFixed(2)}</span>
          `;
        }
      }
    });

    $('totalAmount').textContent = `RM ${grandTotal.toFixed(2)}`;
    $('paidAmount').textContent = `RM ${grandPaid.toFixed(2)}`;
    $('dueAmount').textContent = `RM ${(grandTotal - grandPaid).toFixed(2)}`;
  }

  // ——— Methods CRUD ———
  function openMethodModal(editId = null) {
    const isEdit = Boolean(editId), mon = monthKey(current);
    $('methodModalLabel').textContent = isEdit ? 'Edit Payment Method' : 'Add Payment Method';
    $('methodName').value = isEdit ? getMethodName(data.methods.find(m => m.id === editId), mon) : '';
    
    delete $('saveMethod').dataset.editId;
    if (isEdit) $('saveMethod').dataset.editId = editId;
    
    new bootstrap.Modal($('methodModal')).show();
  }
  
  $('addMethodBtn').onclick = () => openMethodModal();
  
  $('saveMethod').onclick = () => {
    const name = $('methodName').value.trim();
    if (!name) return alert('Name is required');
    const mon = monthKey(current), eid = $('saveMethod').dataset.editId;
    
    if (data.methods.some(m => 
      m.id !== eid && 
      getVersioned(m.names, m.name, mon).toLowerCase() === name.toLowerCase()
    )) return alert('This payment method already exists');
    
    if (eid) {
      const m = data.methods.find(m => m.id === eid);
      m.names = m.names || {};
      m.names[mon] = name;
    } else {
      data.methods.push({ id: uuid(), name, names: {} });
    }
    saveData(); renderAll();
    bootstrap.Modal.getInstance($('methodModal')).hide();
  };

  // FIX: Guarded Method Deletion (Prevents Data Orphans)
  function deleteMethod(id) {
    const hasEntries = data.entries.some(e => Object.values(e.assignments || {}).includes(id));
    
    if (hasEntries) {
      alert("Cannot delete this payment method because it contains historical entries. Rename it instead.");
      return;
    }

    if (!confirm('Delete this empty method?')) return;
    data.methods = data.methods.filter(m => m.id !== id);
    saveData(); renderAll();
  }

  // ——— Entries CRUD ———
  function openEntryModal(editId = null) {
    const isEdit = Boolean(editId), mon = monthKey(current);
    $('entryModalLabel').textContent = isEdit ? 'Edit Entry' : 'Add Entry';
    ['entryItem', 'entryAmount', 'entryDueDay'].forEach(id => $(id).value = '');
    
    delete $('entryForm').dataset.editId;
    
    if (isEdit) {
      const e = data.entries.find(x => x.id === editId);
      $('entryMethod').value = getAssignment(e, mon);
      $('entryItem').value = e.item;
      $('entryAmount').value = e.amount;
      $('entryDueDay').value = e.dueDay;
      $('entryForm').dataset.editId = editId;
    }
    new bootstrap.Modal($('entryModal')).show();
  }
  
  $('addEntryBtn').onclick = () => openEntryModal();
  
  // FIX: Form validation event submission + Historical Edit Protection
  $('entryForm').onsubmit = (e) => {
    e.preventDefault(); 
    
    const mon = monthKey(current);
    const item = $('entryItem').value.trim();
    const amount = parseFloat($('entryAmount').value);
    const dueDay = parseInt($('entryDueDay').value, 10);
    const methodId = $('entryMethod').value;
    const eid = $('entryForm').dataset.editId; 

    if (data.entries.some(ent => {
      const dup = ent.item.toLowerCase() === item.toLowerCase() &&
                  getAssignment(ent, mon) === methodId &&
                  ent.dueDay === dueDay;
      return eid ? dup && ent.id !== eid : dup;
    })) {
      alert('This exact entry already exists for that method & month');
      return;
    }

    if (eid) {
      const ent = data.entries.find(x => x.id === eid);
      const isCoreChange = ent.amount !== amount || ent.item !== item || ent.dueDay !== dueDay;

      if (isCoreChange) {
        // 1. Archive the old entry starting from this month
        ent.assignments = ent.assignments || {};
        ent.assignments[mon] = "DELETED";
        
        // Carry over the "paid" status to the new clone if they already checked it this month
        const newPaidStatus = {};
        if (ent.paid && ent.paid[mon]) {
            newPaidStatus[mon] = true;
            ent.paid[mon] = false; 
        }

        // 2. Create a new cloned entry starting this month with the new values
        data.entries.push({
          id: uuid(), item, amount, dueDay,
          assignments: { [mon]: methodId },
          paid: newPaidStatus, 
          order: {}
        });
      } else {
        // Just updating the payment method version
        ent.assignments = ent.assignments || {}; 
        ent.assignments[mon] = methodId;
      }
    } else {
      // Create brand new entry
      data.entries.push({
        id: uuid(), item, amount, dueDay,
        assignments: { [mon]: methodId },
        paid: {}, order: {}
      });
    }
    
    saveData(); renderAll();
    bootstrap.Modal.getInstance($('entryModal')).hide();
  };

  // FIX: Soft Delete implementation (Preserves historical accounting data)
  function deleteEntry(id) {
    if (!confirm('Remove this entry for this and future months? (Past records are kept)')) return;
    
    const mon = monthKey(current);
    const e = data.entries.find(x => x.id === id);
    
    e.assignments = e.assignments || {};
    e.assignments[mon] = "DELETED"; 
    
    saveData(); renderAll();
  }

  // ——— Export / Import ———
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-${monthKey(new Date())}.json`;
    a.click();
  };
  
  $('importBtn').onclick = () => $('importFileInput').click();
  
  $('importFileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const imp = JSON.parse(r.result);
        
        // FIX: Strict array checking to prevent DB wipe
        if (!imp || !Array.isArray(imp.methods) || !Array.isArray(imp.entries)) {
          throw new Error('Invalid backup file format. Expected valid PayTrack arrays.');
        }
        
        if (confirm('Overwrite current data?')) {
          data = imp; saveData(); renderAll(); alert('Imported.');
        }
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // ——— Startup & Navigation ———
  window.addEventListener('load', () => {
    loadData(); renderAll();
    if (navigator.serviceWorker) navigator.serviceWorker.register('./assets/js/service-worker.js');
  });
  
  $('prevMonth').onclick = () => {
    current.setMonth(current.getMonth() - 1); renderAll();
  };
  
  $('nextMonth').onclick = () => {
    current.setMonth(current.getMonth() + 1); renderAll();
  };
})();
