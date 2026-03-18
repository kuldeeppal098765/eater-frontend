import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [view, setView] = useState('home'); 
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]); 
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [password, setPassword] = useState('');

  // 📝 नया स्टेट: नया आइटम जोड़ने के लिए
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


// 🚀 नया फंक्शन: मेन्यू में आइटम जोड़ना (Category के साथ)
  const handleAddItem = async (e) => {
    e.preventDefault();
    const res = await fetch('https://eater-backend.onrender.com/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...newItem, 
        restaurantId: mahikuRestaurantId, 
        price: Number(newItem.price),
        category: "Fast Food", // 👈 यह नया गार्ड है जो डेटाबेस को खुश रखेगा!
        isVeg: true            // 👈 यह भी जोड़ दिया ताकि कोई एरर न आए
      })
    });
    if (res.ok) {
      alert("✅ आइटम जुड़ गया!");
      setNewItem({ name: '', price: '', description: '' });
      fetchMenu();
    } else {
      alert("❌ सेव नहीं हुआ, बैकएंड में दिक्कत है।");
    }
  };
  // 🗑️ नया फंक्शन: आइटम डिलीट करना
  const deleteItem = async (id) => {
    if(window.confirm("क्या आप इसे हटाना चाहते हैं?")) {
      await fetch(`https://eater-backend.onrender.com/api/menu/${id}`, { method: 'DELETE' });
      fetchMenu();
    }
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
                
                {/* ➕ नया आइटम जोड़ने का फॉर्म */}
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
                    <div key={order.id} className="admin-menu-item" style={{ background: '#f0fdf4', borderLeft: '4px solid #16a34a', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🛒 <strong>Order #{index + 1}</strong> - ₹{order.totalAmount}</span>
                      <span style={{color: '#16a34a'}}><strong>{order.status}</strong></span>
                    </div>
                  ))}
                </div>
                <p style={{fontWeight: 'bold', fontSize: '1.2rem', marginTop: '10px'}}>Total Sales: ₹{orders.reduce((acc, o) => acc + Number(o.totalAmount), 0)}</p>
                </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
export default App