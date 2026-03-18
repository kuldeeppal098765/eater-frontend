import { useState, useEffect } from 'react'
import './App.css'

function App() {
  // 🧭 नया स्टेट: 'home', 'menu' या 'admin'
  const [view, setView] = useState('home'); 
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]); 
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [password, setPassword] = useState('');

  const mahikuRestaurantId = "cd92a6d1-2335-4f5e-9007-ffda681045a1";

  // 🏪 असली दिखने वाले 'नकली' रेस्टोरेंट्स (UI के लिए)
  const mockRestaurants = [
    { id: mahikuRestaurantId, name: 'Mahiku Cafe & Restaurant', emoji: '🍕', rating: '4.9', time: '25-30 min', location: 'Near Arora Resort, Unnao', offer: '20% OFF', tags: 'Pizzas, Fast Food, Coffee' },
    { id: '2', name: 'Kanpur Spice House', emoji: '🍛', rating: '4.5', time: '35-40 min', location: 'Swaroop Nagar, Kanpur', offer: 'Free Delivery', tags: 'North Indian, Biryani' },
    { id: '3', name: 'The Burger Club', emoji: '🍔', rating: '4.2', time: '20-25 min', location: 'Z Square Mall, Kanpur', offer: 'Buy 1 Get 1', tags: 'Burgers, American' },
    { id: '4', name: 'Nawabi Street', emoji: '🍢', rating: '4.7', time: '40-45 min', location: 'Hazratganj, Lucknow', offer: '10% OFF', tags: 'Mughlai, Kebabs' }
  ];

  // 🍔 कैटेगरीज
  const categories = [
    { name: 'Pizza', icon: '🍕' }, { name: 'Burger', icon: '🍔' }, 
    { name: 'Biryani', icon: '🥘' }, { name: 'Coffee', icon: '☕' }, 
    { name: 'Thali', icon: '🍛' }, { name: 'Desserts', icon: '🍰' }
  ];

  useEffect(() => {
    fetchMenu();
    fetchOrders();
  }, []);

  const fetchMenu = () => fetch(`https://eater-backend.onrender.com/api/menu/${mahikuRestaurantId}`).then(res => res.json()).then(data => setMenu(data));
  const fetchOrders = () => fetch(`https://eater-backend.onrender.com/api/orders`).then(res => res.json()).then(data => setOrders(data));

  // कार्ट और आर्डर फंक्शन (पुराने वाले ही हैं)
  const addToCart = (item) => setCart([...cart, item]);
  const removeFromCart = (indexToRemove) => setCart(cart.filter((_, index) => index !== indexToRemove));
  
  const placeCartOrder = async () => {
    if (cart.length === 0) return;
    const totalAmount = cart.reduce((acc, item) => acc + Number(item.price), 0);
    const orderData = { userId: "20303580-7837-44f9-ba88-0136c02aa4f3", restaurantId: mahikuRestaurantId, totalAmount, items: cart.map(item => ({ menuItemId: item.id, quantity: 1, price: Number(item.price) })) };
    const res = await fetch('https://eater-backend.onrender.com/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
    if (res.ok) { alert(`🎉 शानदार! ₹${totalAmount} का ऑर्डर प्लेस हो गया!`); setCart([]); fetchOrders(); setView('home'); }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === 'mahiku123') setIsAdminLoggedIn(true);
    else alert("गलत पासवर्ड! ❌");
    setPassword('');
  };

  return (
    <div className="app-container">
      {/* 📱 Zomato/Swiggy वाला असली Navigation Bar */}
      <nav className="national-nav">
        <div className="nav-left">
          <h1 className="logo-text" onClick={() => setView('home')}>Eater.</h1>
          <div className="location-box">
            <span className="pin-icon">📍</span>
            <div>
              <p className="loc-title">Home</p>
              <p className="loc-desc">Kanpur, Uttar Pradesh, India</p>
            </div>
          </div>
        </div>
        <div className="nav-right">
          <button className="nav-btn" onClick={() => setView('admin')}>💼 Partner Hub</button>
          <div className="cart-icon" onClick={() => setView('menu')}>🛒 <span>{cart.length}</span></div>
          <div className="user-profile">👨‍💼 Kuldeep</div>
        </div>
      </nav>

      {/* 🏡 होमपेज (Multi-Vendor View) */}
      {view === 'home' && (
        <main className="home-content">
          <div className="search-container">
            <input type="text" placeholder="Search for restaurant, cuisine or a dish..." className="search-bar" />
          </div>

          <section className="category-section">
            <h2>Kuldeep, what's on your mind?</h2>
            <div className="category-scroll">
              {categories.map((cat, i) => (
                <div key={i} className="category-bubble">
                  <div className="cat-icon">{cat.icon}</div>
                  <p>{cat.name}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="restaurants-section">
            <h2>Top restaurant chains in your city</h2>
            <div className="restaurant-grid">
              {mockRestaurants.map((rest) => (
                <div key={rest.id} className="rest-card" onClick={() => {
                  if(rest.id === mahikuRestaurantId) setView('menu');
                  else alert("अभी सिर्फ Mahiku Cafe का मेन्यू लाइव है! यह एक डेमो है।");
                }}>
                  <div className="rest-image-placeholder">
                    <span className="rest-huge-emoji">{rest.emoji}</span>
                    <span className="offer-tag">{rest.offer}</span>
                  </div>
                  <div className="rest-info">
                    <h3>{rest.name}</h3>
                    <div className="rest-meta">
                      <span className="rating">⭐ {rest.rating}</span>
                      <span className="time">• {rest.time}</span>
                    </div>
                    <p className="tags">{rest.tags}</p>
                    <p className="location">{rest.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* 🍕 रेस्टोरेंट का मेन्यू (Single-Vendor View) */}
      {view === 'menu' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back to Restaurants</button>
          <header className="cafe-header">
            <h1>Mahiku Cafe & Restaurant 🍕</h1>
            <p>Unnao's Best Flavors, Now Just a Click Away!</p>
          </header>
          
          <div className="customer-layout">
            <div className="menu-grid">
              {menu.map(item => (
                <div key={item.id} className="menu-card">
                  <h3>{item.name}</h3>
                  <p className="desc">{item.description}</p>
                  <p className="price">₹{item.price}</p>
                  <button className="add-btn" onClick={() => addToCart(item)}>Add to Cart 🛒</button>
                </div>
              ))}
            </div>

            <div className="cart-sidebar">
              <h2>Your Cart ({cart.length})</h2>
              {cart.length === 0 ? <p>आपकी टोकरी खाली है। कुछ स्वादिष्ट चुनें! 😋</p> : (
                <div className="cart-items">
                  {cart.map((item, index) => (
                    <div key={index} className="cart-item">
                      <span>{item.name}</span>
                      <div><span>₹{item.price}</span> <button className="remove-btn" onClick={() => removeFromCart(index)}>❌</button></div>
                    </div>
                  ))}
                  <div className="cart-total">
                    <h3>Total: ₹{cart.reduce((acc, item) => acc + Number(item.price), 0)}</h3>
                    <button className="checkout-btn" onClick={placeCartOrder}>Place Order Now</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🔐 एडमिन / पार्टनर डैशबोर्ड */}
      {view === 'admin' && (
        <div className="main-container">
          <button className="back-btn" onClick={() => setView('home')}>⬅ Back to Home</button>
          <section className="admin-view">
            {!isAdminLoggedIn ? (
              <div className="login-form-container">
                <h2>Partner Login 🔐</h2>
                <form onSubmit={handleLogin}>
                  <input type="password" placeholder="Enter Password..." value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="submit" className="add-btn">Login</button>
                </form>
              </div>
            ) : (
              <>
                <div className="admin-header-flex">
                  <h2>Mahiku Cafe Dashboard 📈</h2>
                  <button className="del-btn" onClick={() => setIsAdminLoggedIn(false)}>Logout 🚪</button>
                </div>
                {/* आपका पुराना एडमिन डेटा यहाँ है */}
                <div className="stats-grid">
                  <div className="stat-card"><h3>Total Orders</h3><p>{orders.length}</p></div>
                  <div className="stat-card revenue"><h3>Total Sales</h3><p>₹{orders.reduce((acc, order) => acc + Number(order.totalAmount), 0)}</p></div>
                </div>
                <h2>Live Orders 📊</h2>
                <div className="order-list">
                  {orders.map(order => (
                    <div key={order.id} className="order-item">
                      <p><strong>Order #{order.orderNumber}</strong> - ₹{order.totalAmount}</p>
                      <p>Status: <span className={`status ${order.status}`}>{order.status}</span></p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default App