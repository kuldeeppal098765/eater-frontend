import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { API_URL } from "./apiConfig";
import { adminAuthHeaders, clearAdminJwt, getAdminJwt, setAdminJwt } from "./apiAuth";
import { LS, localSet } from "./frestoStorage";
import {
  AdminCoupons,
  AdminDataBanners,
  AdminLogin,
  AdminMasterOrders,
  AdminNav,
  AdminPartnerKycDrawer,
  AdminRiderKycDrawer,
  AdminRestaurants,
  AdminRiders,
  AdminSettlements,
  AdminTabBar,
  Dashboard,
  Transactions,
  Users,
} from "./admin-components";
import {
  PLATFORM_COMMISSION_RATE,
  RESTAURANT_NET_RATE,
  RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR,
} from "./admin-components/adminConstants";

/**
 * Super-admin ghost entry: persist session for target app (same keys/shape as OTP login)
 * and open that app in a new tab.
 */
export function impersonate(role, data) {
  if (typeof window === "undefined") return;
  try {
    const json = JSON.stringify(data);
    if (role === "CUSTOMER") {
      localSet(LS.customer, json);
      window.open("/", "_blank", "noopener,noreferrer");
    } else if (role === "PARTNER") {
      localSet(LS.partner, json);
      window.open("/partner", "_blank", "noopener,noreferrer");
    } else if (role === "RIDER") {
      localSet(LS.rider, json);
      window.open("/rider", "_blank", "noopener,noreferrer");
    }
  } catch (e) {
    console.error("impersonate:", e);
    alert(e?.message || "Ghost entry failed");
  }
}

export default function Admin() {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => Boolean(getAdminJwt()));
  const [activeTab, setActiveTab] = useState("DASHBOARD");
  const [dataState, setDataState] = useState("idle");

  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRestaurants: 0,
    pendingRestaurants: 0,
    approvedRestaurants: 0,
    infoNeededRestaurants: 0,
    rejectedRestaurants: 0,
    totalUsers: 0,
    totalRiders: 0,
    pendingRiders: 0,
    approvedRiders: 0,
    ridersOnDuty: 0,
    menuItemsPendingReview: 0,
    totalCoupons: 0,
    activeCoupons: 0,
    totalRevenue: 0,
    ordersByStatus: {},
  });
  const [restaurants, setRestaurants] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [riders, setRiders] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [users, setUsers] = useState([]);
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [newCoupon, setNewCoupon] = useState({ code: "", discount: "", minOrderValue: "", type: "FLAT" });

  const [ui, setUi] = useState({ drawer: null, selected: null });
  const [kycMenu, setKycMenu] = useState([]);
  const [adminAlerts, setAdminAlerts] = useState([]);

  const fetchAdminData = async () => {
    setDataState("loading");
    const safeJson = async (res) => {
      if (!res || !res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    };

    const authH = adminAuthHeaders();
    try {
      const results = await Promise.allSettled([
        fetch(`${API_URL}/admin/stats`, { headers: { ...authH } }),
        fetch(`${API_URL}/restaurants/all`),
        fetch(`${API_URL}/orders`),
        fetch(`${API_URL}/admin/riders`, { headers: { ...authH } }),
        fetch(`${API_URL}/admin/coupons`, { headers: { ...authH } }),
        fetch(`${API_URL}/admin/users`, { headers: { ...authH } }),
      ]);

      let hadNetworkFailure = false;
      const jsonAt = async (i) => {
        const r = results[i];
        if (r.status !== "fulfilled") {
          hadNetworkFailure = true;
          return null;
        }
        const data = await safeJson(r.value);
        if (data === null && r.value && !r.value.ok) hadNetworkFailure = true;
        return data;
      };

      const statsData = (await jsonAt(0)) || {};
      const restData = (await jsonAt(1)) || {};
      const ordersData = await jsonAt(2);
      const riderData = await jsonAt(3);
      const couponData = await jsonAt(4);
      const usersData = await jsonAt(5);

      setStats(statsData && !statsData.error ? statsData : {});
      setRestaurants(Array.isArray(restData?.data) ? restData.data : []);
      setAllOrders(Array.isArray(ordersData) ? ordersData : []);
      setRiders(Array.isArray(riderData) ? riderData : []);
      setCoupons(Array.isArray(couponData) ? couponData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);

      const restCount = Array.isArray(restData?.data) ? restData.data.length : 0;
      const orderCount = Array.isArray(ordersData) ? ordersData.length : 0;
      const userCount = Array.isArray(usersData) ? usersData.length : 0;
      const riderCount = Array.isArray(riderData) ? riderData.length : 0;
      const couponCount = Array.isArray(couponData) ? couponData.length : 0;
      const noRealData = restCount + orderCount + userCount + riderCount + couponCount === 0;

      if (hadNetworkFailure && restCount + orderCount + userCount + riderCount + couponCount === 0) setDataState("error");
      else setDataState(noRealData ? "empty" : "ready");
    } catch {
      setDataState("error");
    }
  };

  useEffect(() => {
    if (!isAdminLoggedIn) return;
    fetchAdminData();
    const t = setInterval(fetchAdminData, 10000);
    return () => clearInterval(t);
  }, [isAdminLoggedIn]);

  useEffect(() => {
    if (!isAdminLoggedIn) return;
    const loadAlerts = () =>
      fetch(`${API_URL}/notifications?audience=ADMIN&limit=50`)
        .then((r) => r.json())
        .then((d) => setAdminAlerts(Array.isArray(d.data) ? d.data : []))
        .catch(() => setAdminAlerts([]));
    loadAlerts();
    const t = setInterval(loadAlerts, 8000);
    return () => clearInterval(t);
  }, [isAdminLoggedIn]);

  const unreadAdminAlerts = useMemo(() => adminAlerts.filter((a) => !a.read).length, [adminAlerts]);

  useEffect(() => {
    if (ui.drawer !== "partnerKyc" || !ui.selected?.id) {
      if (ui.drawer !== "partnerKyc") setKycMenu([]);
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/menu/${ui.selected.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setKycMenu(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setKycMenu([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ui.drawer, ui.selected?.id]);

  const platformProfit = (Number(stats.totalRevenue || 0) * PLATFORM_COMMISSION_RATE).toFixed(2);
  const vendorPayout = (Number(stats.totalRevenue || 0) * RESTAURANT_NET_RATE).toFixed(2);

  const restaurantPayouts = restaurants.map((rest) => {
    const restOrders = allOrders.filter((o) => o.restaurantId === rest.id && o.status === "DELIVERED");
    const totalSales = restOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const pendingAmount = restOrders.filter((o) => o.restaurantPaymentStatus !== "PAID").reduce((sum, o) => sum + Number(o.totalAmount || 0), 0) * 0.85;
    return { ...rest, pendingAmount: pendingAmount.toFixed(2), totalSales: totalSales.toFixed(2) };
  });

  const riderPayouts = riders.map((r) => {
    const riderOrders = allOrders.filter((o) => o.riderId === r.id && o.status === "DELIVERED");
    const pendingAmount = riderOrders.filter((o) => o.riderPaymentStatus !== "PAID").length * RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR;
    return { ...r, pendingAmount };
  });

  const transactionHistory = useMemo(() => {
    const list = [];
    allOrders.forEach((o) => {
      if (o.restaurantPaymentStatus === "PAID" && o.restaurantTxnId) {
        list.push({
          id: o.restaurantTxnId,
          type: "RESTAURANT",
          to: o.restaurant?.name || "—",
          amount: Number(o.totalAmount || 0) * RESTAURANT_NET_RATE,
          date: o.updatedAt,
        });
      }
      if (o.riderPaymentStatus === "PAID" && o.riderTxnId) {
        list.push({
          id: o.riderTxnId,
          type: "RIDER",
          to: riders.find((x) => x.id === o.riderId)?.name || "—",
          amount: RIDER_PAYOUT_PER_COMPLETED_DELIVERY_INR,
          date: o.updatedAt,
        });
      }
    });
    return list.reverse();
  }, [allOrders, riders]);

  const userMetrics = users.map((u) => {
    const uOrders = allOrders.filter((o) => o.userId === u.id);
    const delivered = uOrders.filter((o) => o.status === "DELIVERED").length;
    const rejected = uOrders.filter((o) => o.status === "REJECTED").length;
    const totalSpent = uOrders.filter((o) => o.status === "DELIVERED").reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const lastOrderAt =
      uOrders.length > 0
        ? uOrders.reduce((max, o) => {
            const t = new Date(o.createdAt).getTime();
            return t > max ? t : max;
          }, 0)
        : null;
    return {
      ...u,
      totalOrders: uOrders.length,
      delivered,
      rejected,
      totalSpent,
      lastOrderAt: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
      addressCount: u._count?.addresses ?? 0,
      bankOnFile: Boolean(u.bankDetails && String(u.bankDetails).trim()),
    };
  });

  const tabRegistry = [
    { key: "DASHBOARD", label: "Dashboard", badge: null },
    { key: "TRANSACTIONS", label: "Transactions", badge: transactionHistory.length || null },
    { key: "SETTLEMENTS", label: "Settlements", badge: null },
    { key: "MASTER ORDERS", label: "Master Orders", badge: allOrders.length || null },
    { key: "USERS", label: "Users", badge: users.length || null },
    { key: "RESTAURANTS", label: "Restaurants", badge: restaurants.length || null },
    { key: "RIDERS", label: "Riders", badge: riders.length || null },
    { key: "COUPONS", label: "Coupons", badge: coupons.length || null },
  ];

  const actions = {
    async updateRestaurantStatus(id, status) {
      let message = "";
      if (status === "INFO_NEEDED") {
        message = window.prompt("Message to send to partner (required):");
        if (!message) return;
      } else if (!window.confirm(`Apply restaurant status: ${status}?`)) return;
      await fetch(`${API_URL}/admin/restaurant-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ restaurantId: id, status, message }),
      });
      fetchAdminData();
    },
    async updateRiderStatus(id, status) {
      let message = "";
      if (status === "INFO_NEEDED") {
        message = window.prompt("Message to send to rider (required):");
        if (!message) return;
      } else if (!window.confirm(`Apply rider status: ${status}?`)) return;
      await fetch(`${API_URL}/admin/rider-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ riderId: id, status, message }),
      });
      fetchAdminData();
    },
    async settleRider(id, name, amount) {
      if (amount <= 0) return alert("No pending rider payout for this row.");
      const txnId = window.prompt(`Enter UTR / reference for rider payment ₹${amount} to ${name}:`);
      if (!txnId) return;
      await fetch(`${API_URL}/admin/settle-rider`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ riderId: id, txnId }),
      });
      fetchAdminData();
    },
    async settleRestaurant(id, name, amount) {
      if (amount <= 0) return alert("No pending restaurant payout for this row.");
      const txnId = window.prompt(`Enter UTR / reference for restaurant payment ₹${amount} to ${name}:`);
      if (!txnId) return;
      await fetch(`${API_URL}/admin/settle-restaurant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ restaurantId: id, txnId }),
      });
      fetchAdminData();
    },
    async createCoupon(e) {
      e.preventDefault();
      const res = await fetch(`${API_URL}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ ...newCoupon, fundedBy: "ADMIN" }),
      });
      if (res.ok) {
        alert("Platform-funded coupon created.");
        setNewCoupon({ code: "", discount: "", minOrderValue: "", type: "FLAT" });
        fetchAdminData();
      } else alert("Coupon code already exists or invalid");
    },
    async toggleAdminCoupon(couponId, nextActive) {
      const res = await fetch(`${API_URL}/admin/coupon-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ couponId, isActive: nextActive }),
      });
      if (res.ok) fetchAdminData();
      else {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Toggle failed");
      }
    },
    async approvePendingMenu(restaurantId) {
      if (!window.confirm("Approve all PENDING menu items for this outlet?")) return;
      const res = await fetch(`${API_URL}/admin/menu-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ restaurantId }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) return alert(data.error || "Failed to update menu");
      alert(`Approved ${data.count ?? 0} menu item(s).`);
      fetchAdminData();
      const menuRes = await fetch(`${API_URL}/menu/${restaurantId}`);
      const menuData = await menuRes.json().catch(() => []);
      setKycMenu(Array.isArray(menuData) ? menuData : []);
    },
  };

  const filteredOrders = allOrders.filter((o) => orderFilter === "ALL" || o.status === orderFilter);

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <AdminNav
        isAdminLoggedIn={isAdminLoggedIn}
        onLogout={() => {
          clearAdminJwt();
          setIsAdminLoggedIn(false);
        }}
        adminAlerts={adminAlerts}
        setAdminAlerts={setAdminAlerts}
        unreadCount={unreadAdminAlerts}
      />

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 16px" }}>
        {!isAdminLoggedIn ? (
          <AdminLogin
            onSuccess={(payload) => {
              if (payload?.token) setAdminJwt(payload.token);
              setIsAdminLoggedIn(true);
            }}
          />
        ) : (
          <>
            <AdminTabBar tabs={tabRegistry} activeTab={activeTab} onTabChange={setActiveTab} />

            <AdminDataBanners dataState={dataState} />

            {activeTab === "DASHBOARD" && <Dashboard stats={stats} platformProfit={platformProfit} vendorPayout={vendorPayout} />}

            {activeTab === "USERS" && (
              <Users
                userMetrics={userMetrics}
                impersonateCustomer={(u) => {
                  impersonate("CUSTOMER", {
                    id: u.id,
                    phone: u.phone,
                    name: u.name,
                    email: u.email,
                    role: u.role || "CUSTOMER",
                  });
                }}
              />
            )}

            {activeTab === "RESTAURANTS" && (
              <AdminRestaurants
                restaurants={restaurants}
                onOpenPartnerKyc={(r) => setUi((u) => ({ ...u, drawer: "partnerKyc", selected: r }))}
                updateRestaurantStatus={actions.updateRestaurantStatus}
                impersonatePartner={(r) => impersonate("PARTNER", r)}
              />
            )}

            {activeTab === "RIDERS" && (
              <AdminRiders
                riders={riders}
                updateRiderStatus={actions.updateRiderStatus}
                impersonateRider={(r) => impersonate("RIDER", r)}
                onOpenRiderKyc={(r) => setUi((u) => ({ ...u, drawer: "riderKyc", selected: r }))}
              />
            )}

            {activeTab === "TRANSACTIONS" && <Transactions transactionHistory={transactionHistory} />}

            {activeTab === "SETTLEMENTS" && (
              <AdminSettlements
                riderPayouts={riderPayouts}
                restaurantPayouts={restaurantPayouts}
                settleRider={actions.settleRider}
                settleRestaurant={actions.settleRestaurant}
              />
            )}

            {activeTab === "MASTER ORDERS" && (
              <AdminMasterOrders
                orderFilter={orderFilter}
                setOrderFilter={setOrderFilter}
                filteredOrders={filteredOrders}
                onOrdersChanged={fetchAdminData}
              />
            )}

            {activeTab === "COUPONS" && (
              <AdminCoupons
                newCoupon={newCoupon}
                setNewCoupon={setNewCoupon}
                coupons={coupons}
                createCoupon={actions.createCoupon}
                toggleAdminCoupon={actions.toggleAdminCoupon}
              />
            )}

            <AdminPartnerKycDrawer
              open={ui.drawer === "partnerKyc"}
              selectedRestaurant={ui.drawer === "partnerKyc" ? ui.selected : null}
              kycMenu={kycMenu}
              onClose={() => {
                setUi((u) => ({ ...u, drawer: null, selected: null }));
                setKycMenu([]);
              }}
              approvePendingMenu={actions.approvePendingMenu}
            />

            <AdminRiderKycDrawer
              open={ui.drawer === "riderKyc"}
              selectedRider={ui.drawer === "riderKyc" ? ui.selected : null}
              onClose={() => setUi((u) => ({ ...u, drawer: null, selected: null }))}
              updateRiderStatus={actions.updateRiderStatus}
            />
          </>
        )}
      </div>
    </div>
  );
}
