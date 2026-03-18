import { useState, useEffect } from 'react'
import './App.css'

function App() {
  // 🗂️ 1. सारे State Variables (ऐप का डेटा)
  const [view, setView] = useState('home'); 
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]); 
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  
  // फॉर्म्स के लिए स्टेट
  const [newItem, setNewItem] = useState({ name: '', price: '', description: '' });
  const [custInfo, setCustInfo] = useState({ name: '', phone: '' });
  const [vendorForm, setVendorForm] = useState({ name: '', fssai: '', ownerName: '', phone: '' });

  // 🏪 महिकू कैफे की फिक्स ID (अभी के लिए)
  const mahikuRestaurantId = "cd92a6d1-2335-4f5e-9007-ffda681045a1";

  // 🔄 2. ऑटो-रिफ्रेश और डेटा फेचिंग (हर 15 सेकंड में)
  useEffect(() => {
    fetchMenu();
    fetchOrders();
    const interval = setInterval(() => { 
      if (isAdminLoggedIn) fetchOrders(); 
    }, 15000);
    return () => clearInterval(interval);
  }, [isAdminLoggedIn]);

  const fetchMenu = () => {
    fetch(`https://eater-backend.onrender.com/api/menu/${mahikuRestaurantId}`)
      .then(res => res.json())
      .then(data => setMenu(data))
      .catch(err => console.log("Menu fetch error"));
  };
  
  const fetchOrders = () => {
    fetch(`https://eater-backend.onrender.com/api/orders`)
      .then(res => res.json())
      .then(data => {
        // 🔔 नया आर्डर आने पर घंटी बजेगी
        if (data.length > orders.length && orders.length > 0) {
          new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(e => console.log("Sound error"));
        }
        setOrders(data);
      })
      .catch(err => console.log("Order fetch error"));
  };

  // 🛠️ 3. एडमिन के काम (डिलीवर करना, नया डिश जोड़ना)
  const updateOrderStatus = async (orderId) => {
    await fetch(`https://eater-backend.onrender.com/api/orders/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status: 'DELIVERED' })
    });
    fetchOrders();
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const res = await fetch('https://eater-backend.onrender.com/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, restaurantId: mahikuRestaurantId, price: Number(newItem.price), category: "Fast Food", isVeg: true })
    });
    if (res.ok) { 
      alert("✅ आइटम मेन्यू में जुड़ गया!"); 
      setNewItem({ name: '', price: '', description: '' }); 
      fetchMenu(); 
    }
  };

  // 🖨️ 4. बिल प्रिंटिंग का जादुई फंक्शन
  const printBill = (order, index) => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <style>
            body { font-family: 'Courier New', monospace; text-align: center; padding: 20px; }
            .bill { border: 1px dashed #000; padding: 15px; width: 260px; margin: auto; }
            .line { border-top: 1px dashed #000; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="bill">
            <h2>MAHIKU CAFE 🍕</h2>
            <p>Order #${orders.length - index} | ${new Date(order.createdAt).toLocaleDateString()}</p>
            <div class="line"></div>
            <p style="text-align:left">
              <strong>Cust:</strong> ${order.user?.name || 'Guest User'}<br>
              <strong>Phone:</strong> ${order.user?.phone || 'N/A'}
            </p>
            <div class="line"></div>
            <p style="text-align:left">Fast Food / Pizza Items</p>
            <h3 style="margin:10px 0">Total: ₹${order.totalAmount}</h3>
            <div class="line"></div>
            <p>धन्यवाद! फिर आइयेगा। 🙏</p>
          </div>
          <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // 🛒 5. आर्डर प्लेस करना (कस्टमर साइड)
  const placeCartOrder = async () => {
    if (cart.length === 0 || !custInfo.name || !custInfo.phone) {
      alert("कृपया कार्ट में आइटम जोड़ें और अपना नाम व फोन नंबर दर्ज करें! 📝");
      return;
    }
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { 
      userId: "20303580-7837-44f9-ba88-0136c02aa4f3", // Master Key for old backend support
      userName: custInfo.name, 
      userPhone: custInfo.phone,
      restaurantId: mahikuRestaurantId, 
      totalAmount, 
      items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) 
    };

    try {
      const res = await fetch('https://eater-backend.onrender.com/api/orders', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(orderData) 
      });

      if (res.ok) { 
        alert(`🎉 बधाई हो! आपका ऑर्डर प्लेस हो गया।`); 
        setCart([]); 
        setCustInfo({name:'', phone:''}); 
        fetchOrders(); 
        setView('home'); 
      } else {
        alert("❌ ऑर्डर फेल हो गया। सर्वर में कुछ दिक्कत है।");
      }
    } catch (err) {
      alert("🌐 नेटवर्क एरर: कृपया अपना इंटरनेट चेक करें।");
    }
  };

  // 📝 6. नया रेस्टोरेंट (वेंडर) रजिस्टर करना
  const registerRestaurant = async (e) => {
    e.preventDefault();
    alert(`🎉 बधाई हो ${vendorForm.ownerName} जी! '${vendorForm.name}' की रिक्वेस्ट हमारे पास आ गई है। (Backend API coming soon)`);
    setVendorForm({ name: '', fssai: '', ownerName: '', phone: '' });
    setView('home');
  };

  // 📊 7. कमाई का हिसाब
  const todaySales = orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString()).reduce((acc, o) => acc + Number(o.totalAmount), 0);
  const todayOrdersCount = orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString()).length;

  // 🎨 8. असली UI (रेंडरिंग)
  return (
    <div className="app-container">
      {/* --- 🌐 नेविगेशन बार --- */}
      <nav className="national-nav">
        <h1 className="logo-text" onClick={() => setView('home')} style={{cursor:'pointer'}}>Eater.</h1>
        <div className="nav-right">
          <button className="nav-btn" onClick={() => setView('vendor-register')}>🏪 Add Restaurant</button>
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
        </div>
      </nav>

      {/* --- 🏠 होम पेज (कस्टमर व्यू) --- */}
      {view === 'home' && (
        <main className="home-content">
          <div className="hero-banner">
            <h2>Delicious Food, Delivered Fast 🚀</h2>
            <p>Order from Unnao's finest restaurants!</p>
          </div>
          <div className="restaurant-grid">
            <div className="rest-card" onClick={() => setView('menu')}>
              <span className="rest-huge-emoji">🍕</span>
              <h3>Mahiku Cafe & Restaurant</h3>
              <p style={{color: '#64748b', fontSize: '14px'}}>Pizzas, Fast Food, Coffee • Unnao</p>
            </div>
            {/* भविष्य में यहाँ और भी रेस्टोरेंट्स दिखेंगे */}
          </div>
        </main>
      )}

      {/* --- 🍔 मेन्यू और कार्ट पेज --- */}
      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back to Home</button>
          <div className="customer-layout">
            
            {/* मेन्यू लिस्ट */}
            <div className="menu-grid">
              {menu.length === 0 ? <p>Loading menu...</p> : menu.map(item => (
                <div key={item.id} className="menu-card">
                  <h3>{item.name}</h3>
                  <p>₹{item.price}</p>
                  <button className="add-btn" onClick={() => setCart([...cart, item])}>Add to Cart +</button>
                </div>
              ))}
            </div>

            {/* चेकआउट साइडबार */}
            <div className="cart-sidebar">
              <h3 style={{marginTop: 0, color: '#ea580c'}}>Checkout 🛒</h3>
              <input type="text" placeholder="Your Full Name" value={custInfo.name} onChange={e => setCustInfo({...custInfo, name: e.target.value})} />
              <input type="number" placeholder="Phone Number" value={custInfo.phone} onChange={e => setCustInfo({...custInfo, phone: e.target.value})} />
              <hr style={{borderColor: '#f1f5f9', margin: '20px 0'}} />
              
              <div style={{maxHeight: '200px', overflowY: 'auto'}}>
                {cart.map((it, i) => <p key={i} style={{fontSize: '14px', display: 'flex', justifyContent: 'space-between'}}><span>{it.name}</span> <span>₹{it.price}</span></p>)}
              </div>
              
              {cart.length > 0 && (
                <>
                  <hr style={{borderColor: '#f1f5f9', margin: '20px 0'}} />
                  <h3 style={{display: 'flex', justifyContent: 'space-between'}}>Total: <span>₹{cart.reduce((a, b) => a + Number(b.price), 0)}</span></h3>
                  <button className="checkout-btn" onClick={placeCartOrder}>Place Order Now</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 📝 वेंडर रजिस्ट्रेशन (नया रेस्टोरेंट जोड़ना) --- */}
      {view === 'vendor-register' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <div className="login-form-container" style={{ maxWidth: '500px', margin: 'auto', background: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)' }}>
            <h2 style={{ color: '#ea580c', textAlign: 'center', marginTop: 0 }}>Partner With Eater 🚀</h2>
            <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '25px' }}>Register your restaurant and digitize your menu today!</p>
            
            <form onSubmit={registerRestaurant} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="text" placeholder="Restaurant Name (उदा: Sharma Dhaba)" value={vendorForm.name} onChange={e => setVendorForm({...vendorForm, name: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="text" placeholder="Owner Name" value={vendorForm.ownerName} onChange={e => setVendorForm({...vendorForm, ownerName: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="number" placeholder="Phone Number" value={vendorForm.phone} onChange={e => setVendorForm({...vendorForm, phone: e.target.value})} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="text" placeholder="FSSAI License Number (Optional)" value={vendorForm.fssai} onChange={e => setVendorForm({...vendorForm, fssai: e.target.value})} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <button type="submit" className="checkout-btn" style={{ marginTop: '10px' }}>Submit Application ✅</button>
            </form>
          </div>
        </div>
      )}

      {/* --- 👨‍💼 पार्टनर हब (एडमिन डैशबोर्ड) --- */}
      {view === 'admin' && (
        <div className="main-container">
          {!isAdminLoggedIn ? (
            <div style={{ maxWidth: '400px', margin: 'auto', background: 'white', padding: '30px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', textAlign: 'center' }}>
              <h2 style={{ color: '#ea580c' }}>Admin Login 🔐</h2>
              <form onSubmit={(e) => { e.preventDefault(); if(password==='mahiku123') setIsAdminLoggedIn(true); else alert('Wrong Password'); }}>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter Password..." style={{ width: '90%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <button type="submit" className="add-btn">Login to Dashboard</button>
              </form>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, color: '#1e293b' }}>Mahiku Cafe Dashboard 📈</h2>
                <button onClick={() => {setIsAdminLoggedIn(false); setPassword('');}} className="back-btn" style={{ margin: 0 }}>Logout</button>
              </div>

              {/* 📊 एनालिटिक्स कार्ड्स */}
              <div className="summary-cards" style={{display:'flex', gap:'15px', marginBottom:'30px'}}>
                <div className="card" style={{background:'#f0fdf4', padding:'20px', borderRadius:'12px', flex:1, border:'1px solid #bbf7d0'}}>
                  <p style={{margin:0, color:'#16a34a', fontWeight:'600'}}>Today's Sales</p>
                  <h2 style={{margin:'5px 0 0 0', fontSize:'28px'}}>₹{todaySales}</h2>
                </div>
                <div className="card" style={{background:'#fff7ed', padding:'20px', borderRadius:'12px', flex:1, border:'1px solid #fed7aa'}}>
                  <p style={{margin:0, color:'#ea580c', fontWeight:'600'}}>Total Orders Today</p>
                  <h2 style={{margin:'5px 0 0 0', fontSize:'28px'}}>{todayOrdersCount}</h2>
                </div>
              </div>

              {/* ➕ मेन्यू में आइटम जोड़ना */}
              <div style={{background: 'white', padding: '20px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)'}}>
                <h3 style={{marginTop: 0}}>Add New Dish 🍲</h3>
                <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input type="text" placeholder="Dish Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} required style={{flex: 1, padding:'10px', borderRadius:'6px', border:'1px solid #ccc'}}/>
                  <input type="number" placeholder="Price (₹)" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} required style={{width: '100px', padding:'10px', borderRadius:'6px', border:'1px solid #ccc'}}/>
                  <button type="submit" className="add-btn" style={{width: 'auto'}}>Save to Menu</button>
                </form>
              </div>

              {/* 🍔 लाइव आर्डर्स लिस्ट */}
              <h3>Live Orders ({orders.length}) 📊</h3>
              <div className="admin-menu-list">
                {orders.slice().reverse().map((order, index) => (
                  <div key={order.id} className="admin-menu-item" style={{background: order.status==='DELIVERED'?'#f8fafc':'#f0fdf4', display:'flex', justifyContent:'space-between', padding:'15px', marginBottom:'12px', border: order.status==='DELIVERED'?'1px solid #e2e8f0':'1px solid #bbf7d0'}}>
                    <div>
                      <div style={{fontSize: '18px'}}>🛒 <strong>Order #{orders.length - index}</strong> - <span style={{color: '#ea580c', fontWeight: 'bold'}}>₹{order.totalAmount}</span></div>
                      <div style={{fontSize: '14px', color: '#64748b', marginTop: '5px'}}>👤 {order.user?.name || 'Guest'} | 📱 {order.user?.phone || 'N/A'}</div>
                    </div>
                    <div style={{display:'flex', gap:'10px', alignItems: 'center'}}>
                      <button onClick={() => printBill(order, index)} style={{background:'#3b82f6', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', fontWeight: 'bold', cursor: 'pointer'}}>Print 🖨️</button>
                      {order.status === 'PENDING' ? (
                        <button onClick={() => updateOrderStatus(order.id)} style={{background:'#16a34a', color:'white', border:'none', padding:'8px 15px', borderRadius:'6px', fontWeight: 'bold', cursor: 'pointer'}}>Deliver ✅</button>
                      ) : (
                        <span style={{color: '#94a3b8', fontWeight: 'bold', padding: '0 10px'}}>DELIVERED</span>
                      )}
                    </div>
                  </div>
                ))}
                {orders.length === 0 && <p style={{color: '#64748b', textAlign: 'center', padding: '20px'}}>No orders yet. Waiting for customers...</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App