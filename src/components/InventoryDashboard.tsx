import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  serverTimestamp,
  increment,
  writeBatch
} from 'firebase/firestore';
import { 
  Package, 
  Truck, 
  Users, 
  ArrowLeftRight, 
  Plus, 
  AlertTriangle, 
  Search,
  Building2,
  History,
  CheckCircle2,
  Clock,
  ChevronRight
} from 'lucide-react';
import { db } from '../firebase';
import { formatDateTime } from '../utils';

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  lowStockThreshold: number;
}

interface StockLevel {
  id: string;
  itemId: string;
  branchId: string;
  quantity: number;
}

interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
}

interface StockTransfer {
  id: string;
  itemId: string;
  fromBranchId: string;
  toBranchId: string;
  quantity: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: any;
  createdBy: string;
}

interface Branch {
  id: string;
  name: string;
}

export default function InventoryDashboard({ userProfile }: { userProfile: any }) {
  const [activeTab, setActiveTab] = useState<'stocks' | 'suppliers' | 'transfers'>('stocks');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stocks, setStocks] = useState<StockLevel[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'inventory_items'), (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
    });
    const unsubStocks = onSnapshot(collection(db, 'inventory_stocks'), (snapshot) => {
      setStocks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockLevel)));
    });
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snapshot) => {
      setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });
    const unsubTransfers = onSnapshot(collection(db, 'stock_transfers'), (snapshot) => {
      setTransfers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockTransfer)));
    });
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snapshot) => {
      setBranches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Branch)));
    });

    return () => {
      unsubItems();
      unsubStocks();
      unsubSuppliers();
      unsubTransfers();
      unsubBranches();
    };
  }, []);

  const handleCreateTransfer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const transferData = {
      itemId: formData.get('itemId') as string,
      fromBranchId: formData.get('fromBranchId') as string,
      toBranchId: formData.get('toBranchId') as string,
      quantity: Number(formData.get('quantity')),
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: userProfile?.uid || 'unknown'
    };

    // Simple validation: check if enough stock at source
    const sourceStock = stocks.find(s => s.itemId === transferData.itemId && s.branchId === transferData.fromBranchId);
    if (!sourceStock || sourceStock.quantity < transferData.quantity) {
      alert("Insufficient stock at source branch!");
      return;
    }

    await addDoc(collection(db, 'stock_transfers'), transferData);
    setIsTransferring(false);
  };

  const handleCompleteTransfer = async (transfer: StockTransfer) => {
    const batch = writeBatch(db);
    
    // Update source stock
    const sourceStockQuery = query(collection(db, 'inventory_stocks'), 
      where('itemId', '==', transfer.itemId), 
      where('branchId', '==', transfer.fromBranchId)
    );
    const sourceSnap = await getDocs(sourceStockQuery);
    if (!sourceSnap.empty) {
      batch.update(doc(db, 'inventory_stocks', sourceSnap.docs[0].id), {
        quantity: increment(-transfer.quantity)
      });
    }

    // Update destination stock
    const destStockQuery = query(collection(db, 'inventory_stocks'), 
      where('itemId', '==', transfer.itemId), 
      where('branchId', '==', transfer.toBranchId)
    );
    const destSnap = await getDocs(destStockQuery);
    if (!destSnap.empty) {
      batch.update(doc(db, 'inventory_stocks', destSnap.docs[0].id), {
        quantity: increment(transfer.quantity)
      });
    } else {
      const newStockRef = doc(collection(db, 'inventory_stocks'));
      batch.set(newStockRef, {
        itemId: transfer.itemId,
        branchId: transfer.toBranchId,
        quantity: transfer.quantity
      });
    }

    // Mark transfer as completed
    batch.update(doc(db, 'stock_transfers', transfer.id), { status: 'completed' });
    
    await batch.commit();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory Management</h1>
          <p className="text-slate-500">Track stocks, manage suppliers, and handle branch transfers.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'stocks' && (
            <button 
              onClick={() => setIsAddingItem(true)}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Item
            </button>
          )}
          {activeTab === 'suppliers' && (
            <button 
              onClick={() => setIsAddingSupplier(true)}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Supplier
            </button>
          )}
          {activeTab === 'transfers' && (
            <button 
              onClick={() => setIsTransferring(true)}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
            >
              <ArrowLeftRight className="w-4 h-4" /> New Transfer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button 
          onClick={() => setActiveTab('stocks')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${activeTab === 'stocks' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Package className="w-4 h-4" /> Stocks & Levels
        </button>
        <button 
          onClick={() => setActiveTab('suppliers')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${activeTab === 'suppliers' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Users className="w-4 h-4" /> Suppliers
        </button>
        <button 
          onClick={() => setActiveTab('transfers')}
          className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${activeTab === 'transfers' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <ArrowLeftRight className="w-4 h-4" /> Stock Transfers
        </button>
      </div>

      {/* Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {activeTab === 'stocks' && (
          <div className="p-0">
            <div className="p-4 border-b border-slate-100 flex items-center gap-4 bg-slate-50/50">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search items by name or SKU..."
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                    <th className="px-6 py-4">Item Details</th>
                    {branches.map(branch => (
                      <th key={branch.id} className="px-6 py-4 text-center">{branch.name}</th>
                    ))}
                    <th className="px-6 py-4 text-center">Total</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.filter(item => 
                    item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                    item.sku.toLowerCase().includes(searchTerm.toLowerCase())
                  ).map(item => {
                    const itemStocks = stocks.filter(s => s.itemId === item.id);
                    const totalQty = itemStocks.reduce((sum, s) => sum + s.quantity, 0);
                    const isLow = totalQty <= item.lowStockThreshold;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900 group-hover:text-teal-700 transition-colors">{item.name}</span>
                            <span className="text-xs text-slate-500 font-mono">{item.sku} • {item.category}</span>
                          </div>
                        </td>
                        {branches.map(branch => {
                          const qty = itemStocks.find(s => s.branchId === branch.id)?.quantity || 0;
                          return (
                            <td key={branch.id} className="px-6 py-4 text-center">
                              <span className={`text-sm font-medium ${qty === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{qty}</span>
                            </td>
                          );
                        })}
                        <td className="px-6 py-4 text-center font-bold text-slate-900 bg-slate-50/30">
                          {totalQty} {item.unit}
                        </td>
                        <td className="px-6 py-4">
                          {isLow ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold ring-1 ring-inset ring-red-600/20">
                              <AlertTriangle className="w-3 h-3" /> Low Stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold ring-1 ring-inset ring-emerald-600/20">
                              <CheckCircle2 className="w-3 h-3" /> Healthy
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'suppliers' && (
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map(supplier => (
              <div key={supplier.id} className="p-4 border border-slate-200 rounded-xl hover:border-teal-300 transition-all bg-white group relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-5 h-5 text-slate-300" />
                </div>
                <h3 className="font-bold text-slate-900">{supplier.name}</h3>
                <p className="text-sm text-slate-500 mb-3">{supplier.contactPerson}</p>
                <div className="space-y-1">
                  <p className="text-xs text-slate-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                    {supplier.email}
                  </p>
                  <p className="text-xs text-slate-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                    {supplier.phone}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'transfers' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase border-b border-slate-200">
                  <th className="px-6 py-4">Transfer Details</th>
                  <th className="px-6 py-4">From → To</th>
                  <th className="px-6 py-4">Qty</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()).map(transfer => {
                  const item = items.find(i => i.id === transfer.itemId);
                  const from = branches.find(b => b.id === transfer.fromBranchId);
                  const to = branches.find(b => b.id === transfer.toBranchId);
                  
                  return (
                    <tr key={transfer.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">{item?.name}</span>
                          <span className="text-xs text-slate-400">{transfer.createdAt?.toDate ? formatDateTime(transfer.createdAt.toDate()) : 'Pending'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Building2 className="w-3.5 h-3.5" /> {from?.name}
                          <ArrowLeftRight className="w-3 h-3 text-slate-300" />
                          <Building2 className="w-3.5 h-3.5" /> {to?.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm">{transfer.quantity}</td>
                      <td className="px-6 py-4">
                        {transfer.status === 'completed' ? (
                          <span className="text-emerald-600 flex items-center gap-1 text-xs font-bold uppercase"><CheckCircle2 className="w-3 h-3" /> Completed</span>
                        ) : transfer.status === 'pending' ? (
                          <span className="text-amber-500 flex items-center gap-1 text-xs font-bold uppercase"><Clock className="w-3 h-3" /> Pending</span>
                        ) : (
                          <span className="text-slate-400 flex items-center gap-1 text-xs font-bold uppercase"><X className="w-3 h-3" /> Cancelled</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {transfer.status === 'pending' && (
                          <button 
                            onClick={() => handleCompleteTransfer(transfer)}
                            className="bg-teal-50 text-teal-700 px-3 py-1 rounded text-xs font-bold hover:bg-teal-100 transition-colors ring-1 ring-inset ring-teal-600/20"
                          >
                            Mark Completed
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {isTransferring && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">New Stock Transfer</h2>
              <button onClick={() => setIsTransferring(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTransfer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Select Item</label>
                <select name="itemId" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Choose an item...</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">From Branch</label>
                  <select name="fromBranchId" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Select source...</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">To Branch</label>
                  <select name="toBranchId" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="">Select dest...</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Quantity</label>
                <input type="number" name="quantity" required min="1" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsTransferring(false)} className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-all">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-all shadow-md shadow-teal-600/20">Initiate Transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Item Modal (Simplified) */}
      {isAddingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Add Inventory Item</h2>
              <button onClick={() => setIsAddingItem(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await addDoc(collection(db, 'inventory_items'), {
                name: f.get('name'),
                sku: f.get('sku'),
                category: f.get('category'),
                unit: f.get('unit'),
                lowStockThreshold: Number(f.get('threshold'))
              });
              setIsAddingItem(false);
            }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Item Name</label>
                <input type="text" name="name" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">SKU/Code</label>
                  <input type="text" name="sku" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
                  <input type="text" name="category" required placeholder="e.g. Creams" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Unit</label>
                  <input type="text" name="unit" required placeholder="e.g. bottles" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Low Threshold</label>
                  <input type="number" name="threshold" required defaultValue={10} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsAddingItem(false)} className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-all">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-all">Add Item</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Modal (Simplified) */}
      {isAddingSupplier && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Add Supplier</h2>
              <button onClick={() => setIsAddingSupplier(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await addDoc(collection(db, 'suppliers'), {
                name: f.get('name'),
                contactPerson: f.get('contact'),
                email: f.get('email'),
                phone: f.get('phone')
              });
              setIsAddingSupplier(false);
            }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Supplier Name</label>
                <input type="text" name="name" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Contact Person</label>
                <input type="text" name="contact" required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Email</label>
                  <input type="email" name="email" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Phone</label>
                  <input type="text" name="phone" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsAddingSupplier(false)} className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-all">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-all">Add Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Internal helper for batch operations
async function getDocs(q: any) {
  const { getDocs: firestoreGetDocs } = await import('firebase/firestore');
  return firestoreGetDocs(q);
}

const X = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
