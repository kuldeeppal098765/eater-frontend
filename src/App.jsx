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

  const mahikuRestaurantId = "cd92a6d1-2335-4f5e-9007-ffda681045a1";

  const mockRestaurants = [
    { id: mahikuRestaurantId, name: 'Mahiku Cafe & Restaurant', emoji: '🍕', rating: '4.9', time: '25-30 min', location: 'Near Arora Resort, Unnao', offer: '20% OFF', tags: 'Pizzas, Fast Food, Coffee' },
    { id: '2', name: 'Kanpur Spice House', emoji: '🍛', rating: '4.5', time: '35-40 min', location: 'Swaroop Nagar, Kanpur', offer: 'Free Delivery', tags: 'North Indian, Biryani' },
    { id: '3', name: 'The Burger Club', emoji: '🍔', rating: '4.2', time: '20-25 min', location: 'Z Square Mall, Kanpur', offer: 'Buy 1 Get 1', tags: 'Burgers, American' }
  ];

  const categories = [
    { name: 'Pizza', icon: '🍕' }, { name: 'Burger', icon: '🍔' }, 
    { name: 'Biryani', icon: '🥘' }, { name: 'Coffee', icon: '☕' }
  ];

  useEffect(() => {
    fetchMenu();
    fetchOrders();
  }, []);

  const fetchMenu = () => fetch(`https://eater-backend.onrender.com/api/menu/${mahikuRestaurantId}`).then(res => res.json()).then(data => setMenu(data));
  const fetchOrders = () => fetch(`https://eater-backend.onrender.com/api/orders`).then(res => res.json()).then(data => setOrders(data));

  const handleAddItem = async (e) => {
    e.preventDefault();
    const res = await fetch('https://eater-backend.onrender.com/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, restaurantId: mahikuRestaurantId, price: Number(newItem.price), category: "Fast Food", isVeg: true })
    });
    if (res.ok) {
      alert("✅ आइटम जुड़ गया!");
      setNewItem({ name: '', price: '', description: '' });
      fetchMenu();
    }
  };

  const deleteItem = async (id) => {
    if(window.confirm("क्या आप इसे हटाना चाहते हैं?")) {
      await fetch(`https://eater-backend.onrender.com/api/menu/${id}`, { method: 'DELETE' });
      fetchMenu();
    }
  };

  const updateOrderStatus = async (orderId) => {
    try {
      const res = await fetch(`https://eater-backend.onrender.com/api/orders/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: orderId, status: 'DELIVERED' })
      });
      if (res.ok) fetchOrders();
    } catch (err) { console.error(err); }
  };

  const printBill = (order, index) => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head><title>Invoice - Mahiku Cafe</title><style>body { font-family: 'Courier New', monospace; text-align: center; } .bill-card { border: 1px dashed #000; padding: 15px; width: 250px; margin: auto; } .total { font-weight: bold; margin-top: 10px; border-top: 1px solid #000; }</style></head>
        <body>
          <div class="bill-card">
            <h2>MAHIKU CAFE 🍕</h2>
            <p>Order #${index + 1} | ${new Date().toLocaleDateString()}</p>
            <p>Items: Pizza (Regular)</p>
            <div class="total">Total: ₹${order.totalAmount}</div>
            <p>धन्यवाद! 🙏</p>
          </div>
          <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const addToCart = (item) => setCart([...cart, item]);
  const removeFromCart = (indexToRemove) => setCart(cart.filter((_, index) => index !== indexToRemove));
  
  const placeCartOrder = async () => {
    if (cart.length === 0) return;
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { userId: "20303580-7837-44f9-ba88-0136c02aa4f3", restaurantId: mahikuRestaurantId, totalAmount, items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) };
    const res = await fetch('https://eater-backend.onrender.com/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
    if (res.ok) { alert(`🎉 ऑर्डर प्लेस हो गया!`); setCart([]); fetchOrders(); setView('home'); }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === 'mahiku123') setIsAdminLoggedIn(true);
    else alert("गलत पासवर्ड! ❌");
    setPassword('');
  };

  return (
    <div className="app-container">
      <nav className="national-nav">
        <div className="nav-left">
          <h1 className="logo-text" onClick={() => setView('home')}>Eater.</h1>
          <div className="location-box">📍 <div><p className="loc-title">Home</p><p className="loc-desc">Unnao, UP</p></div></div>
        </div>
        <div className="nav-right">
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
          <div className="user-profile">👨‍💼 Kuldeep</div>
        </div>
      </nav>

      {view === 'home' && (
        <main className="home-content">
          <section className="category-section">
            <h2>Kuldeep, what's on your mind?</h2>
            <div className="category-scroll">
              {categories.map((cat, i) => <div key={i} className="category-bubble"><div className="cat-icon">{cat.icon}</div><p>{cat.name}</p></div>)}
            </div>
          </section>
          <section className="restaurants-section">
            <h2>Top restaurants in Unnao</h2>
            <div className="restaurant-grid">
              {mockRestaurants.map((rest) => (
                <div key={rest.id} className="rest-card" onClick={() => rest.id === mahikuRestaurantId ? setView('menu') : alert("डेमो मोड")}>
                  <div className="rest-image-placeholder"><span className="rest-huge-emoji">{rest.emoji}</span><span className="offer-tag">{rest.offer}</span></div>
                  <div className="rest-info"><h3>{rest.name}</h3><p className="tags">{rest.tags}</p></div>
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <header className="cafe-header"><h1>Mahiku Cafe 🍕</h1></header>
          <div className="customer-layout">
            <div className="menu-grid">
              {menu.map(item => (
                <div key={item.id} className="menu-card">
                  <h3>{item.name}</h3><p className="price">₹{item.price}</p>
                  <button className="add-btn" onClick={() => addToCart(item)}>Add 🛒</button>
                </div>
              ))}
            </div>
            <div className="cart-sidebar">
              <h2>Cart ({cart.length})</h2>
              {cart.map((item, i) => <div key={i} className="cart-item">{item.name} - ₹{item.price}</div>)}
              {cart.length > 0 && <button className="checkout-btn" onClick={placeCartOrder}>Order Now</button>}
            </div>
          </div>
        </div>
      )}

      {view === 'admin' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back</button>
          <section className="admin-view">
            {!isAdminLoggedIn ? (
              <div className="login-form-container">
                <h2>Partner Login 🔐</h2>
                <form onSubmit={handleLogin}>
                  <input type="password" placeholder="Password..." value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="submit" className="add-btn">Login</button>
                </form>
              </div>
            ) : (
              <>
                <div className="admin-header-flex"><h2>Admin Dashboard 📈</h2><button onClick={() => setIsAdminLoggedIn(false)}>Logout</button></div>
                <div className="add-item-form card">
                  <h3>Add New Dish 🍲</h3>
                  <form onSubmit={handleAddItem}>
                    <input type="text" placeholder="Dish Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} required />
                    <input type="number" placeholder="Price" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} required />
                    <input type="text" placeholder="Description" value={newItem.description} onChange={e => setNewItem({...newItem, description: e.target.value})} />
                    <button type="submit" className="add-btn">Save to Menu</button>
                  </form>
                </div>

                <h3>Current Menu 📋</h3>
                <div className="admin-menu-list">
                  {menu.map(item => (
                    <div key={item.id} className="admin-menu-item">
                      <span>{item.name} - ₹{item.price}</span>
                      <button className="del-btn" onClick={() => deleteItem(item.id)}>🗑️ Delete</button>
                    </div>
                  ))}
                </div>

                <h3>Live Orders 📊</h3>
<div className="admin-menu-list">
  {orders.map((order, index) => (
    <div key={order.id} className="admin-menu-item" style={{ background: order.status === 'DELIVERED' ? '#f3f4f6' : '#f0fdf4', borderLeft: '4px solid #16a34a', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>🛒 <strong>Order #{index + 1}</strong> - ₹{order.totalAmount}</span>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <span style={{ color: order.status === 'DELIVERED' ? '#6b7280' : '#16a34a' }}><strong>{order.status}</strong></span>
        
        {/* 🖨️ प्रिंट बटन अब हमेशा दिखेगा */}
        <button 
          onClick={() => printBill(order, index)} 
          style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
        >
          Print 🖨️
        </button>

        {/* ✅ डिलीवर बटन सिर्फ पेंडिंग वालों के लिए */}
        {order.status === 'PENDING' && (
          <button 
            onClick={() => updateOrderStatus(order.id)} 
            style={{ background: '#16a34a', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
          >
            Deliver ✅
          </button>
        )}
      </div>
    </div>
  ))}
</div>
                <p style={{fontWeight: 'bold', fontSize: '1.2rem'}}>Total Sales: ₹{orders.reduce((acc, o) => acc + Number(o.totalAmount), 0)}</p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
export default App