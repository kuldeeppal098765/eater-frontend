import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [view, setView] = useState('home'); 
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]); 
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  
  const [newItem, setNewItem] = useState({ name: '', price: '', description: '' });
  const [custInfo, setCustInfo] = useState({ name: '', phone: '' });
  const [vendorForm, setVendorForm] = useState({ name: '', fssai: '', ownerName: '', phone: '' });

  const [restaurantsList, setRestaurantsList] = useState([]);
  const [activeRestId, setActiveRestId] = useState("");
  const [activeRestName, setActiveRestName] = useState("");
  const [vendorLoginId, setVendorLoginId] = useState('');
  const [loggedInVendor, setLoggedInVendor] = useState(null);

  // 🔑 कस्टमर की डमी ID (भविष्य में OTP लॉगिन से आएगी)
  const myCustomerId = "20303580-7837-44f9-ba88-0136c02aa4f3";

  useEffect(() => {
    fetchRestaurantsList();
    fetchOrders();
    const interval = setInterval(() => { fetchOrders(); }, 10000); // कस्टमर और वेंडर दोनों के लिए हर 10 सेकंड में रिफ्रेश
    return () => clearInterval(interval);
  }, []);

  const fetchRestaurantsList = () => {
    fetch('https://eater-backend.onrender.com/api/restaurants').then(res => res.json()).then(data => setRestaurantsList(data.data || []));
  };

  const fetchMenu = (restaurantId) => {
    fetch(`https://eater-backend.onrender.com/api/menu/${restaurantId}`).then(res => res.json()).then(data => setMenu(data));
  };
  
  const fetchOrders = () => {
    fetch(`https://eater-backend.onrender.com/api/orders`).then(res => res.json()).then(data => {
      if (data.length > orders.length && orders.length > 0 && isAdminLoggedIn) {
        new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>console.log("audio error"));
      }
      setOrders(data);
    });
  };

  const handleVendorLogin = (e) => {
    e.preventDefault();
    if(vendorLoginId === 'mahiku123') {
       setLoggedInVendor({ id: "cd92a6d1-2335-4f5e-9007-ffda681045a1", name: "Mahiku Cafe" });
       setIsAdminLoggedIn(true);
       fetchMenu("cd92a6d1-2335-4f5e-9007-ffda681045a1");
       return;
    }
    const found = restaurantsList.find(r => r.id === vendorLoginId.trim());
    if (found) {
      setLoggedInVendor(found);
      setIsAdminLoggedIn(true);
      fetchMenu(found.id);
    } else { alert("❌ गलत Restaurant ID!"); }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const res = await fetch('https://eater-backend.onrender.com/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newItem, restaurantId: loggedInVendor.id, price: Number(newItem.price), category: "Food", isVeg: true }) });
    if (res.ok) { alert("✅ आइटम जुड़ गया!"); setNewItem({ name: '', price: '', description: '' }); fetchMenu(loggedInVendor.id); }
  };

  const deleteItem = async (itemId) => {
    if(window.confirm("क्या आप सच में इस आइटम को हटाना चाहते हैं?")) {
      await fetch(`https://eater-backend.onrender.com/api/menu/${itemId}`, { method: 'DELETE' });
      fetchMenu(loggedInVendor.id);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    await fetch(`https://eater-backend.onrender.com/api/orders/update-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, status: newStatus }) });
    fetchOrders();
  };

  const printBill = (order, index) => {
    let itemsListHTML = '';
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        let itemName = item.menuItem?.name || 'Dish'; 
        let itemPrice = item.priceAtOrder || item.price || 0;
        itemsListHTML += `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>${itemName} x${item.quantity || 1}</span><span>₹${itemPrice}</span></div>`;
      });
    } else { itemsListHTML = `<p style="text-align:left; font-size:14px;">Food Items</p>`; }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><style>body{font-family:'Courier New',monospace;text-align:center;padding:20px}.bill{border:1px dashed #000;padding:15px;width:260px;margin:auto}.line{border-top:1px dashed #000;margin:10px 0}</style></head><body><div class="bill"><h2>${loggedInVendor?.name || 'Restaurant'} 🏪</h2><p style="font-size:12px;">Order #${orders.length - index} | ${new Date(order.createdAt).toLocaleDateString()}</p><div class="line"></div><p style="text-align:left; font-size:14px; margin:5px 0;"><strong>Cust:</strong> ${order.user?.name || 'Guest'}<br><strong>Phone:</strong> ${order.user?.phone || 'N/A'}</p><div class="line"></div><div style="margin: 15px 0;">${itemsListHTML}</div><div class="line"></div><h3 style="margin:10px 0; display:flex; justify-content:space-between;"><span>Total:</span><span>₹${order.totalAmount}</span></h3><div class="line"></div><p style="font-size:14px;">धन्यवाद! 🙏</p></div><script>setTimeout(()=>{window.print();window.close();},500);</script></body></html>`);
    printWindow.document.close();
  };

  const placeCartOrder = async () => {
    if (cart.length === 0 || !custInfo.name || !custInfo.phone) return alert("कृपया कार्ट में आइटम जोड़ें और नाम/नंबर दर्ज करें!");
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { userId: myCustomerId, userName: custInfo.name, userPhone: custInfo.phone, restaurantId: activeRestId, totalAmount, items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) };
    try {
      const res = await fetch('https://eater-backend.onrender.com/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
      if (res.ok) { 
        alert(`🎉 ऑर्डर प्लेस हो गया!`); 
        setCart([]); 
        fetchOrders(); 
        setView('my-orders'); // 🚀 आर्डर होते ही कस्टमर को ट्रैकिंग पेज पर भेजें
      }
    } catch (err) { alert("🌐 नेटवर्क एरर!"); }
  };

  const registerRestaurant = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('https://eater-backend.onrender.com/api/restaurants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: vendorForm.name, ownerName: vendorForm.ownerName, phone: vendorForm.phone, fssai: vendorForm.fssai }) });
      if (res.ok) {
        const data = await res.json();
        alert(`🎉 बधाई हो!\n'${vendorForm.name}' रजिस्टर हो गया है।\nलॉगिन के लिए आपका Restaurant ID है:\n\n${data.data.id}\n\n(इसे सुरक्षित रख लें)`);
        setVendorForm({ name: '', fssai: '', ownerName: '', phone: '' });
        fetchRestaurantsList(); setView('home');
      }
    } catch (err) { alert("🌐 नेटवर्क एरर!"); }
  };

  // डेटा कैलकुलेशन
  const vendorOrders = loggedInVendor ? orders.filter(o => o.restaurantId === loggedInVendor.id) : [];
  const myCustomerOrders = orders.filter(o => o.userId === myCustomerId); // कस्टमर के आर्डर्स

  return (
    <div className="app-container">
      <nav className="national-nav">
        <h1 className="logo-text" onClick={() => setView('home')} style={{cursor:'pointer'}}>Eater.</h1>
        <div className="nav-right">
          {/* 🚀 नया "My Orders" बटन */}
          <button className="nav-btn" onClick={() => setView('my-orders')} style={{background: '#f8fafc', borderColor: '#cbd5e1', color: '#334155'}}>📦 My Orders</button>
          <button className="nav-btn" onClick={() => setView('vendor-register')}>🏪 Add Restaurant</button>
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
        </div>
      </nav>

      {/* 🚀 नया कस्टमर ट्रैकिंग पेज (My Orders) */}
      {view === 'my-orders' && (
        <div className="main-container" style={{maxWidth: '800px', margin: 'auto'}}>
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back to Home</button>
          <h2 style={{marginTop: 0, color: '#1e293b'}}>My Orders & Tracking 📍</h2>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
            {myCustomerOrders.length === 0 ? <p style={{textAlign: 'center', color: '#64748b'}}>You haven't ordered anything yet.</p> : 
              myCustomerOrders.slice().reverse().map((order) => {
                const restName = restaurantsList.find(r => r.id === order.restaurantId)?.name || 'Restaurant';
                // प्रोग्रेस बार की चौड़ाई सेट करना
                let progressWidth = '10%'; 
                let barColor = '#3b82f6'; // नीला
                if(order.status === 'ACCEPTED') { progressWidth = '50%'; barColor = '#eab308'; } // पीला
                if(order.status === 'DELIVERED') { progressWidth = '100%'; barColor = '#16a34a'; } // हरा
                if(order.status === 'REJECTED') { progressWidth = '100%'; barColor = '#ef4444'; } // लाल

                return (
                  <div key={order.id} style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px'}}>
                      <h3 style={{margin: 0, color: '#334155'}}>Order from {restName}</h3>
                      <span style={{fontWeight: 'bold', color: '#ea580c', fontSize: '18px'}}>₹{order.totalAmount}</span>
                    </div>
                    
                    {/* 🚦 लाइव ट्रैकिंग बार */}
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#64748b', fontWeight: 'bold'}}>
                      <span style={{color: order.status !== 'REJECTED' ? '#3b82f6' : '#94a3b8'}}>📝 Placed</span>
                      <span style={{color: (order.status === 'ACCEPTED' || order.status === 'DELIVERED') ? '#eab308' : '#94a3b8'}}>🍳 Preparing</span>
                      <span style={{color: order.status === 'DELIVERED' ? '#16a34a' : '#94a3b8'}}>🛵 Delivered</span>
                    </div>
                    
                    <div style={{background: '#f1f5f9', height: '10px', borderRadius: '5px', marginBottom: '15px', overflow: 'hidden'}}>
                      <div style={{ background: barColor, height: '100%', width: progressWidth, transition: 'width 0.8s ease, background 0.8s ease' }}></div>
                    </div>

                    {order.status === 'REJECTED' && <p style={{color: '#ef4444', fontWeight: 'bold', margin: 0, textAlign: 'center'}}>❌ Order Cancelled by Restaurant</p>}
                    
                    {/* ⭐ रेटिंग सिस्टम (डिलीवर होने के बाद) */}
                    {order.status === 'DELIVERED' && (
                      <div style={{marginTop: '15px', paddingTop: '15px', borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <p style={{margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#334155'}}>How was your food? 😋</p>
                        <div>
                          <span style={{cursor:'pointer', fontSize:'20px'}} onClick={()=>alert('Thanks for 1 star!')}>⭐</span>
                          <span style={{cursor:'pointer', fontSize:'20px'}} onClick={()=>alert('Thanks for 2 stars!')}>⭐</span>
                          <span style={{cursor:'pointer', fontSize:'20px'}} onClick={()=>alert('Thanks for 3 stars!')}>⭐</span>
                          <span style={{cursor:'pointer', fontSize:'20px'}} onClick={()=>alert('Thanks for 4 stars!')}>⭐</span>
                          <span style={{cursor:'pointer', fontSize:'20px'}} onClick={()=>alert('Thanks for 5 stars! 🌟')} title="Rate 5 Stars">⭐</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
            })}
          </div>
        </div>
      )}

      {/* बाकि के पेजेज (Home, Menu, Admin, Register) वैसे ही हैं... */}
      {view === 'home' && (
        <main className="home-content">
          <div className="hero-banner"><h2>Delicious Food, Delivered Fast 🚀</h2></div>
          <div className="restaurant-grid">
            {restaurantsList.length === 0 ? <p style={{textAlign:'center', width:'100%'}}>Loading restaurants...</p> : restaurantsList.map(rest => (
              <div key={rest.id} className="rest-card" onClick={() => { setActiveRestId(rest.id); setActiveRestName(rest.name); fetchMenu(rest.id); setView('menu'); }}>
                <span className="rest-huge-emoji">🏪</span><h3>{rest.name}</h3>
              </div>
            ))}
          </div>
        </main>
      )}

      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back to Home</button>
          <h2 style={{marginTop: 0, color: '#1e293b'}}>{activeRestName} - Menu 🍽️</h2>
          <div className="customer-layout">
            <div className="menu-grid">
              {menu.length === 0 ? <p>No items in menu yet.</p> : menu.map(item => (
                <div key={item.id} className="menu-card"><h3>{item.name}</h3><p>₹{item.price}</p><button className="add-btn" onClick={() => setCart([...cart, item])}>Add to Cart +</button></div>
              ))}
            </div>
            <div className="cart-sidebar">
              <h3 style={{marginTop: 0, color: '#ea580c'}}>Checkout 🛒</h3>
              <input type="text" placeholder="Your Name" value={custInfo.name} onChange={e => setCustInfo({...custInfo, name: e.target.value})} />
              <input type="number" placeholder="Phone Number" value={custInfo.phone} onChange={e => setCustInfo({...custInfo, phone: e.target.value})} />
              <hr />
              {cart.map((it, i) => <p key={i} style={{display:'flex', justifyContent:'space-between'}}><span>{it.name}</span><span>₹{it.price}</span></p>)}
              {cart.length > 0 && (<><hr /><h3 style={{display:'flex', justifyContent:'space-between'}}>Total:<span>₹{cart.reduce((a, b) => a + Number(b.price), 0)}</span></h3><button className="checkout-btn" onClick={placeCartOrder}>Place Order Now</button></>)}
            </div>
          </div>
        </div>
      )}

      {view === 'vendor-register' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <div className="login-form-container" style={{ maxWidth: '500px', margin: 'auto', background: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
            <h2 style={{ color: '#ea580c', textAlign: 'center', marginTop: 0 }}>Partner With Eater 🚀</h2>
            <form onSubmit={registerRestaurant} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="text" placeholder="Restaurant Name" value={vendorForm.name} onChange={e => setVendorForm({...vendorForm, name: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="text" placeholder="Owner Name" value={vendorForm.ownerName} onChange={e => setVendorForm({...vendorForm, ownerName: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="number" placeholder="Phone Number" value={vendorForm.phone} onChange={e => setVendorForm({...vendorForm, phone: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <button type="submit" className="checkout-btn" style={{ marginTop: '10px' }}>Submit Application ✅</button>
            </form>
          </div>
        </div>
      )}

      {view === 'admin' && (
        <div className="main-container">
          {!isAdminLoggedIn ? (
            <div style={{ maxWidth: '400px', margin: 'auto', background: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', textAlign: 'center' }}>
              <h2 style={{ color: '#ea580c' }}>Partner Login 🔐</h2>
              <form onSubmit={handleVendorLogin}>
                <input type="text" value={vendorLoginId} onChange={e => setVendorLoginId(e.target.value)} placeholder="Enter Restaurant ID..." style={{ width: '90%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #cbd5e1' }} required/>
                <button type="submit" className="add-btn">Login to Dashboard</button>
              </form>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0 }}>{loggedInVendor?.name} Dashboard 📈</h2>
                <button onClick={() => {setIsAdminLoggedIn(false); setVendorLoginId(''); setLoggedInVendor(null);}} className="back-btn" style={{ margin: 0 }}>Logout</button>
              </div>
              
              <div className="summary-cards" style={{display:'flex', gap:'15px', marginBottom:'30px'}}>
                <div className="card" style={{background:'#f0fdf4', padding:'20px', borderRadius:'12px', flex:1, border:'1px solid #bbf7d0'}}><p style={{margin:0, color:'#16a34a', fontWeight:'600'}}>Today's Sales (Delivered)</p><h2 style={{margin:'5px 0 0 0', fontSize:'28px'}}>₹{todaySales}</h2></div>
                <div className="card" style={{background:'#fff7ed', padding:'20px', borderRadius:'12px', flex:1, border:'1px solid #fed7aa'}}><p style={{margin:0, color:'#ea580c', fontWeight:'600'}}>Total Orders Today</p><h2 style={{margin:'5px 0 0 0', fontSize:'28px'}}>{todayOrdersCount}</h2></div>
              </div>

              <div style={{background: 'white', padding: '20px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)'}}>
                <h3 style={{marginTop: 0}}>Manage Menu 🍲</h3>
                <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                  <input type="text" placeholder="Dish Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} required style={{flex: 1, padding:'10px', borderRadius:'6px', border:'1px solid #ccc'}}/>
                  <input type="number" placeholder="Price (₹)" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} required style={{width: '100px', padding:'10px', borderRadius:'6px', border:'1px solid #ccc'}}/>
                  <button type="submit" className="add-btn" style={{width: 'auto'}}>Add Item</button>
                </form>

                <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                  {menu.length === 0 ? <p>No items added yet.</p> : menu.map(m => (
                    <div key={m.id} style={{display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0'}}>
                      <span><strong>{m.name}</strong> - ₹{m.price}</span>
                      <button onClick={() => deleteItem(m.id)} style={{background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Delete 🗑️</button>
                    </div>
                  ))}
                </div>
              </div>

              <h3>Live Orders ({vendorOrders.length}) 📊</h3>
              <div className="admin-menu-list">
                {vendorOrders.slice().reverse().map((order, index) => (
                  <div key={order.id} className="admin-menu-item" style={{background: order.status==='DELIVERED'?'#f8fafc': order.status==='REJECTED'?'#fef2f2' :'#f0fdf4', display:'flex', justifyContent:'space-between', padding:'15px', marginBottom:'12px', border: order.status==='DELIVERED'?'1px solid #e2e8f0': order.status==='REJECTED'?'1px solid #fecaca' :'1px solid #bbf7d0'}}>
                    <div style={{flex: 1}}>
                      <div style={{fontSize: '18px'}}>🛒 <strong>Order #{vendorOrders.length - index}</strong> - <span style={{color: '#ea580c', fontWeight: 'bold'}}>₹{order.totalAmount}</span></div>
                      <div style={{fontSize: '14px', color: '#64748b', marginTop: '5px'}}>👤 {order.user?.name || 'Guest'} | 📱 {order.user?.phone || 'N/A'}</div>
                      <div style={{marginTop: '5px', color: order.status==='PENDING'?'#ea580c': order.status==='ACCEPTED'?'#eab308':'#64748b'}}><strong>Status:</strong> {order.status}</div>
                      
                      <div style={{marginTop: '12px', padding: '10px', background: 'white', borderRadius: '6px', border: '1px dashed #cbd5e1', display: 'inline-block', minWidth: '220px'}}>
                        <p style={{margin: '0 0 5px 0', fontSize: '13px', fontWeight: 'bold', color: '#475569'}}>Items to prepare:</p>
                        {order.items && order.items.length > 0 ? order.items.map((it, i) => (
                          <div key={i} style={{fontSize: '13px', color: '#334155', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', padding: '3px 0'}}>
                            <span>• {it.menuItem?.name || 'Dish'} x{it.quantity || 1}</span>
                            <span>₹{it.priceAtOrder || 0}</span>
                          </div>
                        )) : <div style={{fontSize: '13px', color: '#ef4444'}}>No items found</div>}
                      </div>
                    </div>
                    
                    <div style={{display:'flex', gap:'10px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end'}}>
                      <button onClick={() => printBill(order, index)} style={{background:'#3b82f6', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', cursor: 'pointer'}}>Print 🖨️</button>
                      
                      {order.status === 'PENDING' && (
                        <>
                          <button onClick={() => updateOrderStatus(order.id, 'ACCEPTED')} style={{background:'#eab308', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', cursor: 'pointer'}}>Accept ✅</button>
                          <button onClick={() => updateOrderStatus(order.id, 'REJECTED')} style={{background:'#ef4444', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', cursor: 'pointer'}}>Reject ❌</button>
                        </>
                      )}
                      {order.status === 'ACCEPTED' && (
                        <button onClick={() => updateOrderStatus(order.id, 'DELIVERED')} style={{background:'#16a34a', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', cursor: 'pointer'}}>Mark Delivered 🛵</button>
                      )}
                      {order.status === 'DELIVERED' && <span style={{color: '#16a34a', fontWeight: 'bold', padding: '0 10px'}}>DELIVERED ✅</span>}
                      {order.status === 'REJECTED' && <span style={{color: '#ef4444', fontWeight: 'bold', padding: '0 10px'}}>REJECTED ❌</span>}
                    </div>
                  </div>
                ))}
                {vendorOrders.length === 0 && <p style={{color: '#64748b', textAlign: 'center', padding: '20px'}}>No orders yet.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App