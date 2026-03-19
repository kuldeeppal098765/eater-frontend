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

  const myCustomerId = "20303580-7837-44f9-ba88-0136c02aa4f3";

  useEffect(() => {
    fetchRestaurantsList();
    fetchOrders();
    const interval = setInterval(() => { fetchOrders(); }, 10000); 
    return () => clearInterval(interval);
  }, []);

  const fetchRestaurantsList = () => {
    fetch('https://eater-backend.onrender.com/api/restaurants')
      .then(res => res.json())
      .then(data => setRestaurantsList(Array.isArray(data.data) ? data.data : []))
      .catch(() => setRestaurantsList([]));
  };

  const fetchMenu = (restaurantId) => {
    if(!restaurantId) return;
    fetch(`https://eater-backend.onrender.com/api/menu/${restaurantId}`)
      .then(res => res.json())
      .then(data => setMenu(Array.isArray(data) ? data : []))
      .catch(() => setMenu([]));
  };
  
  const fetchOrders = () => {
    fetch(`https://eater-backend.onrender.com/api/orders`)
      .then(res => res.json())
      .then(data => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]));
  };

  const handleVendorLogin = (e) => {
    e.preventDefault();
    const inputId = vendorLoginId.trim();
    if(inputId === 'mahiku123') {
       const mahiku = { id: "cd92a6d1-2335-4f5e-9007-ffda681045a1", name: "Mahiku Cafe" };
       setLoggedInVendor(mahiku);
       setIsAdminLoggedIn(true);
       fetchMenu(mahiku.id);
       return;
    }
    const found = restaurantsList.find(r => r.id === inputId);
    if (found) {
      setLoggedInVendor(found);
      setIsAdminLoggedIn(true);
      fetchMenu(found.id);
    } else { alert("❌ गलत Restaurant ID!"); }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if(!loggedInVendor) return;
    const res = await fetch('https://eater-backend.onrender.com/api/menu', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ ...newItem, restaurantId: loggedInVendor.id, price: Number(newItem.price), category: "Food", isVeg: true }) 
    });
    if (res.ok) { alert("✅ आइटम जुड़ गया!"); setNewItem({ name: '', price: '', description: '' }); fetchMenu(loggedInVendor.id); }
  };

  const deleteItem = async (itemId) => {
    if(window.confirm("क्या आप सच में इस आइटम को हटाना चाहते हैं?")) {
      await fetch(`https://eater-backend.onrender.com/api/menu/${itemId}`, { method: 'DELETE' });
      fetchMenu(loggedInVendor?.id);
    }
  };

  // 🛡️ सबसे सुरक्षित और स्मार्ट आर्डर अपडेट फंक्शन
  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      console.log(`Updating order ${orderId} to ${newStatus}...`);
      const res = await fetch(`https://eater-backend.onrender.com/api/orders/update-status`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ orderId, status: newStatus }) 
      });
      
      if(res.ok) {
        fetchOrders(); 
      } else {
        const errorText = await res.text();
        alert(`❌ सर्वर ने स्टेटस बदलने से मना कर दिया। असली वजह:\n\n${errorText}`);
      }
    } catch (err) {
      alert("🌐 नेटवर्क एरर! या बैकएंड सर्वर सो रहा है।");
    }
  };

  const printBill = (order, index) => {
    let itemsListHTML = '';
    const safeItems = Array.isArray(order.items) ? order.items : [];
    safeItems.forEach(item => {
      let itemName = item.menuItem?.name || 'Dish'; 
      let itemPrice = item.priceAtOrder || item.price || 0;
      itemsListHTML += `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>${itemName} x${item.quantity || 1}</span><span>₹${itemPrice}</span></div>`;
    });

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><style>body{font-family:'Courier New',monospace;text-align:center;padding:20px}.bill{border:1px dashed #000;padding:15px;width:260px;margin:auto}.line{border-top:1px dashed #000;margin:10px 0}</style></head><body><div class="bill"><h2>${loggedInVendor?.name || 'Invoice'} 🏪</h2><p>Order #${orders.length - index}</p><div class="line"></div><p style="text-align:left"><strong>Cust:</strong> ${order.user?.name || 'Guest'}<br><strong>Phone:</strong> ${order.user?.phone || 'N/A'}</p><div class="line"></div><div style="margin:15px 0">${itemsListHTML}</div><div class="line"></div><h3>Total: ₹${order.totalAmount}</h3><div class="line"></div><p>धन्यवाद! 🙏</p></div><script>setTimeout(()=>{window.print();window.close();},500);</script></body></html>`);
    printWindow.document.close();
  };

  const placeCartOrder = async () => {
    if (cart.length === 0 || !custInfo.name || !custInfo.phone) return alert("कृपया कार्ट में आइटम जोड़ें और नाम/नंबर दर्ज करें!");
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { userId: myCustomerId, userName: custInfo.name, userPhone: custInfo.phone, restaurantId: activeRestId, totalAmount, items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) };
    try {
      const res = await fetch('https://eater-backend.onrender.com/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
      if (res.ok) { alert(`🎉 ऑर्डर प्लेस हो गया!`); setCart([]); fetchOrders(); setView('my-orders'); }
    } catch (err) { alert("🌐 नेटवर्क एरर!"); }
  };

  const registerRestaurant = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('https://eater-backend.onrender.com/api/restaurants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: vendorForm.name, ownerName: vendorForm.ownerName, phone: vendorForm.phone, fssai: vendorForm.fssai }) });
      if (res.ok) {
        const data = await res.json();
        alert(`🎉 बधाई हो!\nID: ${data.data.id}`);
        setVendorForm({ name: '', fssai: '', ownerName: '', phone: '' });
        fetchRestaurantsList(); setView('home');
      }
    } catch (err) { alert("🌐 नेटवर्क एरर!"); }
  };

  const safeOrders = Array.isArray(orders) ? orders : [];
  const vendorOrders = loggedInVendor ? safeOrders.filter(o => o.restaurantId === loggedInVendor.id) : [];
  const todaySales = vendorOrders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString() && o.status === 'DELIVERED').reduce((acc, o) => acc + Number(o.totalAmount), 0);
  const myCustomerOrders = safeOrders.filter(o => o.userId === myCustomerId);

  return (
    <div className="app-container">
      <nav className="national-nav">
        <h1 className="logo-text" onClick={() => setView('home')} style={{cursor:'pointer'}}>Eater.</h1>
        <div className="nav-right">
          <button className="nav-btn" onClick={() => setView('my-orders')}>📦 My Orders</button>
          <button className="nav-btn" onClick={() => setView('vendor-register')}>🏪 Add Restaurant</button>
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
        </div>
      </nav>

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

      {view === 'my-orders' && (
        <div className="main-container" style={{maxWidth: '800px', margin: 'auto'}}>
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <h2>My Tracking 📍</h2>
          {myCustomerOrders.slice().reverse().map((order) => {
            const restName = restaurantsList.find(r => r.id === order.restaurantId)?.name || 'Restaurant';
            let progressWidth = '10%'; let barColor = '#3b82f6';
            if(order.status === 'ACCEPTED') { progressWidth = '50%'; barColor = '#eab308'; }
            if(order.status === 'DELIVERED') { progressWidth = '100%'; barColor = '#16a34a'; }
            if(order.status === 'REJECTED') { progressWidth = '100%'; barColor = '#ef4444'; }
            return (
              <div key={order.id} style={{background: 'white', padding: '15px', borderRadius: '12px', marginBottom: '15px', border: '1px solid #eee'}}>
                <h4>Order from {restName} - ₹{order.totalAmount}</h4>
                <div style={{background: '#f1f5f9', height: '8px', borderRadius: '4px', overflow: 'hidden'}}>
                  <div style={{ background: barColor, height: '100%', width: progressWidth, transition: '0.5s' }}></div>
                </div>
                <p style={{fontSize: '12px', marginTop: '5px'}}>Status: <strong>{order.status}</strong></p>
              </div>
            )
          })}
        </div>
      )}

      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <h2>{activeRestName} - Menu 🍽️</h2>
          <div className="customer-layout">
            <div className="menu-grid">
              {menu.map(item => (
                <div key={item.id} className="menu-card"><h3>{item.name}</h3><p>₹{item.price}</p><button className="add-btn" onClick={() => setCart([...cart, item])}>Add +</button></div>
              ))}
            </div>
            <div className="cart-sidebar">
              <h3>Cart 🛒</h3>
              <input type="text" placeholder="Name" value={custInfo.name} onChange={e => setCustInfo({...custInfo, name: e.target.value})} />
              <input type="text" placeholder="Phone" value={custInfo.phone} onChange={e => setCustInfo({...custInfo, phone: e.target.value})} />
              <button className="checkout-btn" onClick={placeCartOrder}>Order Now</button>
            </div>
          </div>
        </div>
      )}

      {view === 'vendor-register' && (
        <div className="main-container">
          <div className="login-form-container" style={{maxWidth:'500px', margin:'auto', background:'white', padding:'30px', borderRadius:'16px'}}>
            <h2>Register Restaurant 🚀</h2>
            <form onSubmit={registerRestaurant} style={{display:'flex', flexDirection:'column', gap:'10px'}}>
              <input type="text" placeholder="Name" onChange={e => setVendorForm({...vendorForm, name: e.target.value})} required />
              <input type="text" placeholder="Owner" onChange={e => setVendorForm({...vendorForm, ownerName: e.target.value})} required />
              <input type="text" placeholder="Phone" onChange={e => setVendorForm({...vendorForm, phone: e.target.value})} required />
              <button type="submit" className="checkout-btn">Register</button>
            </form>
          </div>
        </div>
      )}

      {view === 'admin' && (
        <div className="main-container">
          {!isAdminLoggedIn ? (
            <div style={{maxWidth:'400px', margin:'auto', background:'white', padding:'30px', borderRadius:'16px'}}>
              <h2>Partner Login 🔐</h2>
              <form onSubmit={handleVendorLogin}>
                <input type="text" value={vendorLoginId} onChange={e => setVendorLoginId(e.target.value)} placeholder="Restaurant ID..." style={{width:'100%', padding:'10px', marginBottom:'10px'}} required/>
                <button type="submit" className="add-btn" style={{width:'100%'}}>Login</button>
              </form>
            </div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between'}}>
                <h2>{loggedInVendor?.name || 'Partner'} Dashboard</h2>
                <button onClick={() => {setIsAdminLoggedIn(false); setLoggedInVendor(null);}} className="back-btn">Logout</button>
              </div>
              <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
                <div style={{background:'#f0fdf4', padding:'15px', flex:1, borderRadius:'10px'}}>Sales: ₹{todaySales}</div>
                <div style={{background:'#fff7ed', padding:'15px', flex:1, borderRadius:'10px'}}>Orders: {vendorOrders.length}</div>
              </div>

              {/* Menu Management */}
              <div style={{background:'white', padding:'15px', borderRadius:'10px', marginBottom:'20px'}}>
                <h3>Manage Menu</h3>
                <form onSubmit={handleAddItem} style={{display:'flex', gap:'5px'}}>
                  <input type="text" placeholder="Dish" value={newItem.name} onChange={e => setNewItem({...newItem, name:e.target.value})} required/>
                  <input type="number" placeholder="Price" value={newItem.price} onChange={e => setNewItem({...newItem, price:e.target.value})} required/>
                  <button type="submit" className="add-btn">Add</button>
                </form>
                {menu.map(m => (
                  <div key={m.id} style={{display:'flex', justifyContent:'space-between', marginTop:'10px', padding:'5px', borderBottom:'1px solid #eee'}}>
                    <span>{m.name} - ₹{m.price}</span>
                    <button onClick={() => deleteItem(m.id)} style={{color:'red', border:'none', background:'none', cursor:'pointer'}}>Delete</button>
                  </div>
                ))}
              </div>

              {/* Live Orders - यहाँ सारे बटन्स 100% सुरक्षित हैं */}
              <h3>Live Orders</h3>
              {vendorOrders.slice().reverse().map((order, index) => (
                <div key={order.id} style={{
                  background: order.status === 'DELIVERED' ? '#f8fafc' : order.status === 'REJECTED' ? '#fef2f2' : '#f0fdf4', 
                  padding: '15px', 
                  borderRadius: '10px', 
                  marginBottom: '10px', 
                  borderLeft: `5px solid ${order.status === 'REJECTED' ? '#ef4444' : '#ea580c'}`
                }}>
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <span><strong>Order #{vendorOrders.length - index}</strong> - ₹{order.totalAmount}</span>
                    <div style={{display: 'flex', gap: '5px'}}>
                      <button onClick={() => printBill(order, index)}>Print 🖨️</button>
                      {order.status === 'PENDING' && (
                        <>
                          <button onClick={() => updateOrderStatus(order.id, 'ACCEPTED')} style={{background: '#eab308', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px'}}>Accept</button>
                          <button onClick={() => updateOrderStatus(order.id, 'REJECTED')} style={{background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px'}}>Reject</button>
                        </>
                      )}
                      {order.status === 'ACCEPTED' && (
                        <button onClick={() => updateOrderStatus(order.id, 'DELIVERED')} style={{background: '#16a34a', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px'}}>Deliver</button>
                      )}
                    </div>
                  </div>
                  <p style={{fontSize:'12px', margin:'5px 0'}}>👤 {order.user?.name} | <strong style={{color: order.status === 'REJECTED' ? '#ef4444' : '#334155'}}>Status: {order.status}</strong></p>
                  <div style={{fontSize:'12px', background:'white', padding:'8px', borderRadius:'5px', border:'1px dashed #cbd5e1'}}>
                    {order.items?.map((it, i) => <div key={i}>• {it.menuItem?.name} x{it.quantity}</div>)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App