import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [view, setView] = useState('home'); 
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]); 
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [newItem, setNewItem] = useState({ name: '', price: '', description: '' });
  const [custInfo, setCustInfo] = useState({ name: '', phone: '' });

  const mahikuRestaurantId = "cd92a6d1-2335-4f5e-9007-ffda681045a1";

  useEffect(() => {
    fetchMenu();
    fetchOrders();
    // 🔄 हर 15 सेकंड में ऑटो-चेक (बिना रिफ्रेश के आर्डर आएंगे)
    const interval = setInterval(() => { if (isAdminLoggedIn) fetchOrders(); }, 15000);
    return () => clearInterval(interval);
  }, [isAdminLoggedIn]);

  const fetchMenu = () => fetch(`https://eater-backend.onrender.com/api/menu/${mahikuRestaurantId}`).then(res => res.json()).then(data => setMenu(data));
  
  const fetchOrders = () => {
    fetch(`https://eater-backend.onrender.com/api/orders`)
      .then(res => res.json())
      .then(data => {
        // 🔔 नया आर्डर आने पर घंटी बजेगी
        if (data.length > orders.length && orders.length > 0) {
          new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(e => console.log("Click anywhere to enable sound"));
        }
        setOrders(data);
      });
  };

  const updateOrderStatus = async (orderId) => {
    await fetch(`https://eater-backend.onrender.com/api/orders/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status: 'DELIVERED' })
    });
    fetchOrders();
  };

  const printBill = (order, index) => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <style>
            body { font-family: 'Courier New', monospace; text-align: center; padding: 20px; }
            .bill { border: 1px dashed #000; padding: 15px; width: 260px; margin: auto; }
            .line { border-top: 1px solid #000; margin: 10px 0; }
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
            <p style="text-align:left">Pizza (Regular) x 1</p>
            <h3 style="margin:5px">Total Amount: ₹${order.totalAmount}</h3>
            <div class="line"></div>
            <p>धन्यवाद! फिर आइयेगा। 🙏</p>
          </div>
          <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const placeCartOrder = async () => {
    if (cart.length === 0 || !custInfo.name || !custInfo.phone) {
      alert("कृपया अपना नाम और फोन नंबर दर्ज करें! 📝");
      return;
    }
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { 
      userName: custInfo.name, 
      userPhone: custInfo.phone,
      restaurantId: mahikuRestaurantId, 
      totalAmount, 
      items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) 
    };
    const res = await fetch('https://eater-backend.onrender.com/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
    if (res.ok) { alert(`🎉 ऑर्डर प्लेस हो गया!`); setCart([]); setCustInfo({name:'', phone:''}); fetchOrders(); setView('home'); }
  };

  const todaySales = orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString()).reduce((acc, o) => acc + Number(o.totalAmount), 0);

  return (
    <div className="app-container">
      <nav className="national-nav">
        <h1 onClick={() => setView('home')} style={{cursor:'pointer'}}>Eater.</h1>
        <div className="nav-right">
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
        </div>
      </nav>

      {view === 'home' && (
        <main className="home-content">
          <div className="hero-banner"><h2>Unnao's Best: Mahiku Cafe 🍕</h2></div>
          <div className="restaurant-grid">
            <div className="rest-card" onClick={() => setView('menu')}>
              <span className="rest-huge-emoji">🍕</span>
              <h3>Mahiku Cafe & Restaurant</h3>
              <p>Pizzas, Fast Food, Coffee</p>
            </div>
          </div>
        </main>
      )}

      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <div className="customer-layout">
            <div className="menu-grid">
              {menu.map(item => (
                <div key={item.id} className="menu-card">
                  <h3>{item.name}</h3><p>₹{item.price}</p>
                  <button onClick={() => setCart([...cart, item])}>Add +</button>
                </div>
              ))}
            </div>
            <div className="cart-sidebar">
              <h3>Finalize Order 🛒</h3>
              <input type="text" placeholder="Your Name" value={custInfo.name} onChange={e => setCustInfo({...custInfo, name: e.target.value})} />
              <input type="text" placeholder="Phone Number" value={custInfo.phone} onChange={e => setCustInfo({...custInfo, phone: e.target.value})} />
              <hr />
              {cart.map((it, i) => <p key={i}>{it.name} - ₹{it.price}</p>)}
              {cart.length > 0 && <button className="checkout-btn" onClick={placeCartOrder}>Order Now</button>}
            </div>
          </div>
        </div>
      )}

      {view === 'admin' && (
        <div className="main-container">
          {!isAdminLoggedIn ? (
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); if(password==='mahiku123') setIsAdminLoggedIn(true); }}>
              <h2>Admin Login 🔐</h2>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
              <button type="submit">Login</button>
            </form>
          ) : (
            <>
              <div className="admin-header-flex"><h2>Admin Dashboard 📈</h2><button onClick={() => setIsAdminLoggedIn(false)}>Logout</button></div>
              <div className="summary-cards" style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
                <div className="card" style={{background:'#f0fdf4', padding:'15px', borderRadius:'8px', flex:1}}>Today's Sales: <h3>₹{todaySales}</h3></div>
                <div className="card" style={{background:'#f0f9ff', padding:'15px', borderRadius:'8px', flex:1}}>Orders Today: <h3>{orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString()).length}</h3></div>
              </div>
              <h3>Live Orders 📊</h3>
              <div className="admin-menu-list">
                {orders.slice().reverse().map((order, index) => (
                  <div key={order.id} className="admin-menu-item" style={{background: order.status==='DELIVERED'?'#f3f4f6':'#f0fdf4', display:'flex', justifyContent:'space-between', padding:'10px', marginBottom:'10px'}}>
                    <div><strong>#{orders.length - index}</strong> | ₹{order.totalAmount} | {order.user?.name || 'Guest'}</div>
                    <div style={{display:'flex', gap:'5px'}}>
                      <button onClick={() => printBill(order, index)} style={{background:'#3b82f6', color:'white', border:'none', padding:'5px 10px', borderRadius:'4px'}}>Print 🖨️</button>
                      {order.status === 'PENDING' && <button onClick={() => updateOrderStatus(order.id)} style={{background:'#16a34a', color:'white', border:'none', padding:'5px 10px', borderRadius:'4px'}}>Deliver ✅</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
export default App