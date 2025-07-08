// script.js
(() => {
  // ——— Shortcuts & Storage ———
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'paytrack';
  let data = { methods: [], entries: [] };

  const loadData = () => {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) data = JSON.parse(s);
  };
  const saveData = () =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  // ——— UUID v4 ———
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  };

  // ——— Date / Month Helpers ———
  let current = new Date();
  const monthKey = d => d.toISOString().slice(0, 7);
  const formatMonth = d =>
    d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ——— Versioned Lookups ———
  function getVersioned(map = {}, fallback, month) {
    const ks = Object.keys(map).filter(k => k <= month).sort();
    return ks.length ? map[ks.pop()] : fallback;
  }
  const getMethodName = (m, month) => getVersioned(m.names, m.name, month);
  const getAssignment = (e, month) =>
    getVersioned(e.assignments, data.methods[0]?.id || null, month);
  const getOrder = (e, month) => +getVersioned(e.order, 0, month);

  // ——— Sortable instances ———
  let methodSortable = null,
    entrySortables = [];

  // ——— Main Render ———
  function renderAll() {
    const month = monthKey(current);
    const today = new Date().getDate();

    $('currentMonth').textContent = formatMonth(current);

    const container = $('methodsContainer');
    container.innerHTML = '';

    // No methods
    if (!data.methods.length) {
      $('addEntryBtn').disabled = true;
      container.innerHTML = `
        <div class="alert alert-info text-center">
          No payment methods yet.<br>
          Click <strong>Add Payment Method</strong> to get started!
        </div>`;
      ['totalAmount', 'paidAmount', 'dueAmount'].forEach(id =>
        $(id).textContent = 'RM 0.00'
      );
      methodSortable?.destroy();
      entrySortables.forEach(s => s.destroy());
      methodSortable = null;
      entrySortables = [];
      return;
    }
    $('addEntryBtn').disabled = false;

    let grandTotal = 0,
      grandPaid = 0;

    data.methods.forEach(m => {
      // Gather & sort this method’s entries
      const items = data.entries
        .filter(e => getAssignment(e, month) === m.id)
        .sort((a, b) => getOrder(a, month) - getOrder(b, month));

      // Compute subtotals
      let subTotal = 0,
        subPaid = 0;
      items.forEach(i => {
        subTotal += i.amount;
        if (i.paid?.[month]) subPaid += i.amount;
      });
      grandTotal += subTotal;
      grandPaid += subPaid;

      // Build method card
      const card = document.createElement('div');
      card.className = 'card mb-3';
      card.dataset.methodId = m.id;
      card.innerHTML = `
        <div class="card-header d-flex justify-content-between align-items-center">
          <strong>${getMethodName(m, month)}</strong>
          <span>Subtotal: RM${subTotal.toFixed(2)}</span>
          <div>
            <button class="btn btn-sm btn-outline-secondary edit-method">Edit</button>
            <button class="btn btn-sm btn-outline-danger delete-method">Delete</button>
          </div>
        </div>
        <ul class="list-group list-group-flush"></ul>
      `;
      container.append(card);

      // Attach edit/delete for method
      card.querySelector('.edit-method').onclick = () =>
        openMethodModal(m.id);
      card.querySelector('.delete-method').onclick = () =>
        deleteMethod(m.id);

      const ul = card.querySelector('ul');

      if (items.length) {
        items.forEach(i => {
          const li = document.createElement('li');
          li.className =
            'list-group-item d-flex justify-content-between align-items-center';
          li.dataset.entryId = i.id;

          const isPaid = Boolean(i.paid?.[month]);
          // Highlight if due today or overdue
          if (!isPaid && today >= i.dueDay) {
            li.classList.add('list-group-item-danger');
          }

          // LEFT: checkbox + item + "Due on X"
          const left = document.createElement('div');
          left.className = 'd-flex align-items-center';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'form-check-input me-2';
          cb.checked = isPaid;
          cb.onchange = () => togglePaid(i.id);
          left.append(cb);

          const itemSpan = document.createElement('span');
          itemSpan.textContent = i.item;
          if (isPaid)
            itemSpan.classList.add('text-decoration-line-through');
          left.append(itemSpan);

          const dueSpan = document.createElement('span');
          dueSpan.textContent = `Due on ${i.dueDay}`;
          dueSpan.className = 'badge bg-light text-dark ms-3';
          left.append(dueSpan);

          li.append(left);

          // RIGHT: amount + edit/delete
          const right = document.createElement('div');
          right.className = 'd-flex align-items-center';

          const amt = document.createElement('span');
          amt.textContent = `RM${i.amount.toFixed(2)}`;
          right.append(amt);

          const ee = document.createElement('button');
          ee.className = 'btn btn-sm btn-outline-secondary ms-2 me-1';
          ee.textContent = 'Edit';
          ee.onclick = () => openEntryModal(i.id);
          right.append(ee);

          const de = document.createElement('button');
          de.className = 'btn btn-sm btn-outline-danger';
          de.textContent = 'Delete';
          de.onclick = () => deleteEntry(i.id);
          right.append(de);

          li.append(right);
          ul.append(li);
        });
      } else {
        ul.innerHTML = `<li class="list-group-item text-muted">No entries added</li>`;
      }
    });

    // Update totals footer
    $('totalAmount').textContent = `RM ${grandTotal.toFixed(2)}`;
    $('paidAmount').textContent = `RM ${grandPaid.toFixed(2)}`;
    $('dueAmount').textContent = `RM ${(grandTotal - grandPaid).toFixed(2)}`;

    // Rebuild entry‐method dropdown
    $('entryMethod').innerHTML = data.methods
      .map(
        m => `<option value="${m.id}">${getMethodName(m, month)}</option>`
      )
      .join('');

    // Re-initialize Sortables
    methodSortable?.destroy();
    entrySortables.forEach(s => s.destroy());
    entrySortables = [];

    methodSortable = Sortable.create(container, {
      animation: 150,
      handle: '.card-header',
      onEnd: () => {
        const ids = [...container.children].map(
          c => c.dataset.methodId
        );
        data.methods = ids.map(id =>
          data.methods.find(m => m.id === id)
        );
        saveData();
        renderAll();
      }
    });

    container.querySelectorAll('ul').forEach(ul => {
      const s = Sortable.create(ul, {
        animation: 150,
        handle: '.list-group-item',
        onEnd: () => {
          const mon = monthKey(current);
          [...ul.children].forEach((li, idx) => {
            const e = data.entries.find(
              x => x.id === li.dataset.entryId
            );
            e.order = e.order || {};
            e.order[mon] = idx;
          });
          saveData();
        }
      });
      entrySortables.push(s);
    });
  }

  // ——— Toggle Paid ———
  function togglePaid(id) {
    const mon = monthKey(current);
    const e = data.entries.find(x => x.id === id);
    e.paid = e.paid || {};
    e.paid[mon] = !e.paid[mon];
    saveData();
    renderAll();
  }

  // ——— Payment Methods CRUD ———
  function openMethodModal(editId = null) {
    const isEdit = Boolean(editId);
    const mon = monthKey(current);
    $('methodModalLabel').textContent = isEdit
      ? 'Edit Payment Method'
      : 'Add Payment Method';
    $('methodName').value = isEdit
      ? getMethodName(
          data.methods.find(m => m.id === editId),
          mon
        )
      : '';
    delete $('saveMethod').dataset.editId;
    if (isEdit) $('saveMethod').dataset.editId = editId;
    new bootstrap.Modal($('methodModal')).show();
  }

  $('addMethodBtn').onclick = () => openMethodModal();
  $('saveMethod').onclick = () => {
    const name = $('methodName').value.trim();
    if (!name) return alert('Name is required');
    const mon = monthKey(current);
    const eid = $('saveMethod').dataset.editId;

    if (
      data.methods.some(
        m =>
          m.id !== eid &&
          getVersioned(m.names, m.name, mon).toLowerCase() ===
            name.toLowerCase()
      )
    )
      return alert('This payment method already exists');

    if (eid) {
      const m = data.methods.find(m => m.id === eid);
      m.names = m.names || {};
      m.names[mon] = name;
    } else {
      data.methods.push({ id: uuid(), name, names: {} });
    }
    saveData();
    renderAll();
    bootstrap.Modal.getInstance($('methodModal')).hide();
  };

  function deleteMethod(id) {
    if (!confirm('Delete this method?')) return;
    data.methods = data.methods.filter(m => m.id !== id);
    saveData();
    renderAll();
  }

  // ——— Entries CRUD ———
  function openEntryModal(editId = null) {
    const isEdit = Boolean(editId);
    const mon = monthKey(current);
    $('entryModalLabel').textContent = isEdit ? 'Edit Entry' : 'Add Entry';
    ['entryItem', 'entryAmount', 'entryDueDay'].forEach(id =>
      ($(id).value = '')
    );
    delete $('saveEntry').dataset.editId;
    if (isEdit) {
      const e = data.entries.find(x => x.id === editId);
      $('entryMethod').value = getAssignment(e, mon);
      $('entryItem').value = e.item;
      $('entryAmount').value = e.amount;
      $('entryDueDay').value = e.dueDay;
      $('saveEntry').dataset.editId = editId;
    }
    new bootstrap.Modal($('entryModal')).show();
  }

  $('addEntryBtn').onclick = () => openEntryModal();
  $('saveEntry').onclick = () => {
    const mon = monthKey(current);
    const item = $('entryItem').value.trim();
    const amount = parseFloat($('entryAmount').value);
    const dueDay = parseInt($('entryDueDay').value, 10);
    const methodId = $('entryMethod').value;
    const eid = $('saveEntry').dataset.editId;

    if (!item || isNaN(amount) || isNaN(dueDay) || dueDay < 1 || dueDay > 31)
      return alert('All fields required; due day 1–31');

    // Duplicate check
    if (
      data.entries.some(e => {
        const same =
          e.item.toLowerCase() === item.toLowerCase() &&
          getAssignment(e, mon) === methodId &&
          e.dueDay === dueDay;
        return eid ? same && e.id !== eid : same;
      })
    )
      return alert('This entry already exists for that method & month');

    if (eid) {
      const e = data.entries.find(x => x.id === eid);
      e.item = item;
      e.amount = amount;
      e.dueDay = dueDay;
      e.assignments = e.assignments || {};
      e.assignments[mon] = methodId;
    } else {
      data.entries.push({
        id: uuid(),
        item,
        amount,
        dueDay,
        assignments: { [mon]: methodId },
        paid: {},
        order: {}
      });
    }
    saveData();
    renderAll();
    bootstrap.Modal.getInstance($('entryModal')).hide();
  };

  function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    data.entries = data.entries.filter(e => e.id !== id);
    saveData();
    renderAll();
  }

  // ——— Export / Import ———
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
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
        if (!imp.methods || !imp.entries) throw new Error('Invalid');
        if (confirm('Overwrite current data?')) {
          data = imp;
          saveData();
          renderAll();
          alert('Imported.');
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
    loadData();
    renderAll();
    $('methodModal')?.addEventListener('hide.bs.modal', () =>
      $('addMethodBtn').focus()
    );
    $('entryModal')?.addEventListener('hide.bs.modal', () =>
      $('addEntryBtn').focus()
    );
    if (navigator.serviceWorker)
      navigator.serviceWorker.register('./service-worker.js');
  });

  $('prevMonth').onclick = () => {
    current.setMonth(current.getMonth() - 1);
    renderAll();
  };
  $('nextMonth').onclick = () => {
    current.setMonth(current.getMonth() + 1);
    renderAll();
  };
})();
