"""City presets, vehicle catalogue and synthetic scenario generation."""
from __future__ import annotations

import math
import random
from typing import Any

# Locality anchors are real neighbourhood coordinates. Orders are jittered a
# few hundred metres around them so that every point lands on land/roads.
CITIES: dict[str, dict[str, Any]] = {
    "bengaluru": {
        "name": "Bengaluru",
        "center": [77.6100, 12.9716],
        "zoom": 11.2,
        "depot": {"name": "Q-Hub Shivajinagar", "lng": 77.6057, "lat": 12.9857},
        "localities": [
            ("Koramangala", 77.6245, 12.9352), ("Indiranagar", 77.6408, 12.9784),
            ("Whitefield", 77.7500, 12.9698), ("HSR Layout", 77.6389, 12.9116),
            ("Jayanagar", 77.5826, 12.9299), ("Malleshwaram", 77.5643, 13.0031),
            ("Hebbal", 77.5970, 13.0358), ("Electronic City", 77.6602, 12.8452),
            ("Marathahalli", 77.6974, 12.9591), ("BTM Layout", 77.6101, 12.9166),
            ("Yelahanka", 77.5963, 13.1007), ("Rajajinagar", 77.5525, 12.9915),
            ("Banashankari", 77.5468, 12.9255), ("JP Nagar", 77.5857, 12.9063),
            ("Bellandur", 77.6762, 12.9260), ("Yeshwanthpur", 77.5340, 13.0250),
            ("Basavanagudi", 77.5738, 12.9406), ("Frazer Town", 77.6136, 12.9971),
            ("KR Puram", 77.6950, 13.0076), ("Sarjapur Road", 77.6870, 12.9010),
        ],
    },
    "mumbai": {
        "name": "Mumbai",
        "center": [72.8700, 19.0900],
        "zoom": 11.0,
        "depot": {"name": "Q-Hub BKC", "lng": 72.8650, "lat": 19.0660},
        "localities": [
            ("Andheri East", 72.8697, 19.1136), ("Bandra East", 72.8430, 19.0607),
            ("Powai", 72.9060, 19.1176), ("Dadar", 72.8478, 19.0178),
            ("Lower Parel", 72.8302, 18.9980), ("Goregaon", 72.8526, 19.1663),
            ("Malad", 72.8484, 19.1874), ("Borivali", 72.8567, 19.2307),
            ("Kurla", 72.8845, 19.0726), ("Ghatkopar", 72.9081, 19.0860),
            ("Chembur", 72.9005, 19.0522), ("Vile Parle", 72.8490, 19.0990),
            ("Santacruz", 72.8460, 19.0810), ("Mulund", 72.9425, 19.1726),
            ("Sion", 72.8619, 19.0390), ("Byculla", 72.8330, 18.9790),
            ("Wadala", 72.8650, 19.0170), ("Vikhroli", 72.9280, 19.1110),
            ("Kandivali", 72.8526, 19.2047), ("Jogeshwari", 72.8560, 19.1360),
        ],
    },
    "delhi": {
        "name": "New Delhi",
        "center": [77.1900, 28.6200],
        "zoom": 10.8,
        "depot": {"name": "Q-Hub Pragati Maidan", "lng": 77.2430, "lat": 28.6180},
        "localities": [
            ("Connaught Place", 77.2167, 28.6315), ("Karol Bagh", 77.1909, 28.6519),
            ("Lajpat Nagar", 77.2433, 28.5677), ("Saket", 77.2066, 28.5245),
            ("Dwarka", 77.0460, 28.5921), ("Rohini", 77.0822, 28.7383),
            ("Janakpuri", 77.0878, 28.6219), ("Vasant Kunj", 77.1590, 28.5200),
            ("Mayur Vihar", 77.2940, 28.6090), ("Pitampura", 77.1316, 28.7032),
            ("Rajouri Garden", 77.1220, 28.6492), ("Nehru Place", 77.2533, 28.5491),
            ("Hauz Khas", 77.2001, 28.5494), ("Chandni Chowk", 77.2303, 28.6506),
            ("Okhla", 77.2640, 28.5355), ("Greater Kailash", 77.2380, 28.5482),
            ("Preet Vihar", 77.2950, 28.6415), ("Model Town", 77.1910, 28.7158),
            ("Shahdara", 77.2890, 28.6730), ("Defence Colony", 77.2320, 28.5714),
        ],
    },
    "guwahati": {
        "name": "Guwahati",
        "center": [91.7600, 26.1500],
        "zoom": 11.8,
        "depot": {"name": "Q-Hub Ulubari", "lng": 91.7590, "lat": 26.1680},
        "localities": [
            ("Paltan Bazaar", 91.7510, 26.1790), ("Dispur", 91.7898, 26.1433),
            ("Zoo Road", 91.7780, 26.1690), ("Ganeshguri", 91.7840, 26.1490),
            ("Beltola", 91.7960, 26.1260), ("Chandmari", 91.7720, 26.1810),
            ("Six Mile", 91.8080, 26.1330), ("Khanapara", 91.8220, 26.1210),
            ("Jalukbari", 91.6640, 26.1560), ("Maligaon", 91.7020, 26.1590),
            ("Adabari", 91.7200, 26.1680), ("Christian Basti", 91.7790, 26.1550),
            ("Bhangagarh", 91.7640, 26.1600), ("Hatigaon", 91.7790, 26.1300),
            ("Basistha", 91.7880, 26.1100), ("Lachit Nagar", 91.7570, 26.1720),
            ("Rukminigaon", 91.7930, 26.1400), ("Kahilipara", 91.7600, 26.1350),
            ("Lalganesh", 91.7450, 26.1450), ("Narengi", 91.8250, 26.1800),
        ],
    },
    "kolkata": {
        "name": "Kolkata",
        "center": [88.3900, 22.5550],
        "zoom": 11.3,
        "depot": {"name": "Q-Hub Park Street", "lng": 88.3520, "lat": 22.5530},
        "localities": [
            ("Salt Lake Sector V", 88.4310, 22.5760), ("New Town", 88.4700, 22.5810),
            ("Ballygunge", 88.3650, 22.5280), ("Gariahat", 88.3670, 22.5180),
            ("Howrah", 88.3270, 22.5880), ("Dum Dum", 88.3990, 22.6230),
            ("Behala", 88.3110, 22.4980), ("Tollygunge", 88.3460, 22.4990),
            ("Jadavpur", 88.3710, 22.4990), ("Garia", 88.3880, 22.4630),
            ("Park Circus", 88.3700, 22.5390), ("Shyambazar", 88.3740, 22.6010),
            ("Esplanade", 88.3510, 22.5640), ("Alipore", 88.3320, 22.5300),
            ("Kasba", 88.3880, 22.5150), ("Baguiati", 88.4260, 22.6110),
            ("Salt Lake Sector I", 88.4100, 22.5870), ("Ruby (EM Bypass)", 88.4010, 22.5130),
            ("Sealdah", 88.3700, 22.5680), ("Lake Town", 88.4040, 22.6040),
        ],
    },
}

# Realistic Indian urban logistics vehicles.
VEHICLE_TYPES: dict[str, dict[str, Any]] = {
    "ev_van": {
        "label": "EV Cargo Van", "capacity": 700, "cost_per_km": 2.1,
        "co2_per_km": 0.06, "energy": "electric", "color": [0, 240, 255],
    },
    "diesel_truck": {
        "label": "Diesel Truck", "capacity": 1400, "cost_per_km": 15.8,
        "co2_per_km": 0.45, "energy": "diesel", "color": [255, 61, 172],
    },
    "cng_mini": {
        "label": "CNG Mini Truck", "capacity": 900, "cost_per_km": 6.5,
        "co2_per_km": 0.21, "energy": "cng", "color": [140, 255, 92],
    },
}

ROUTE_PALETTE = [
    [0, 229, 255], [255, 64, 180], [143, 255, 92], [255, 196, 0],
    [160, 110, 255], [255, 120, 70], [60, 255, 200], [255, 90, 110],
    [90, 160, 255], [230, 255, 80],
]

PRIORITIES = {
    # name: (deadline window in minutes after shift start, QUBO urgency weight)
    "critical": (120, 3.0),
    "high": (240, 1.5),
    "standard": (540, 0.0),
}

CUSTOMER_KINDS = [
    "Pharmacy", "Hospital", "Kirana Store", "Restaurant", "Electronics Hub",
    "Supermarket", "Clinic", "Bakery", "Cafe", "Hardware Store", "Warehouse",
    "Apparel Outlet", "Diagnostics Lab", "Book Store", "Office Park",
]

SHIFT_START_MIN = 9 * 60  # 09:00


def jitter(lng: float, lat: float, rng: random.Random, radius_km: float = 0.55):
    r = radius_km * math.sqrt(rng.random())
    t = rng.random() * 2 * math.pi
    dlat = (r * math.cos(t)) / 111.0
    dlng = (r * math.sin(t)) / (111.0 * math.cos(math.radians(lat)))
    return round(lng + dlng, 6), round(lat + dlat, 6)


def generate_scenario(city: str = "bengaluru", n_orders: int = 30,
                      n_vehicles: int = 5, seed: int = 7) -> dict[str, Any]:
    city_key = city if city in CITIES else "bengaluru"
    c = CITIES[city_key]
    rng = random.Random(seed)
    n_orders = max(4, min(int(n_orders), 60))
    n_vehicles = max(2, min(int(n_vehicles), 10))

    type_cycle = ["ev_van", "diesel_truck", "cng_mini", "ev_van", "cng_mini",
                  "diesel_truck", "ev_van", "cng_mini", "ev_van", "diesel_truck"]
    vehicles = []
    for i in range(n_vehicles):
        t = type_cycle[i % len(type_cycle)]
        vt = VEHICLE_TYPES[t]
        vehicles.append({
            "id": f"QX-{i + 1:02d}",
            "type": t,
            "label": vt["label"],
            "capacity": vt["capacity"],
            "cost_per_km": vt["cost_per_km"],
            "co2_per_km": vt["co2_per_km"],
            "color": ROUTE_PALETTE[i % len(ROUTE_PALETTE)],
            "status": "active",
            "start": {"lng": c["depot"]["lng"], "lat": c["depot"]["lat"]},
            "start_time": 0,
        })

    total_cap = sum(v["capacity"] for v in vehicles)
    # Fill ~72% of fleet capacity on average so allocation is non-trivial.
    mean_demand = max(20, int(0.72 * total_cap / n_orders))
    orders = []
    locs = list(c["localities"])
    for i in range(n_orders):
        name, lng, lat = locs[rng.randrange(len(locs))]
        jl, jt = jitter(lng, lat, rng)
        p = rng.random()
        prio = "critical" if p < 0.18 else ("high" if p < 0.45 else "standard")
        demand = max(10, int(rng.gauss(mean_demand, mean_demand * 0.35)))
        orders.append({
            "id": f"ORD-{1001 + i}",
            "customer": f"{rng.choice(CUSTOMER_KINDS)} · {name}",
            "area": name,
            "lng": jl, "lat": jt,
            "demand": demand,
            "priority": prio,
            "deadline": PRIORITIES[prio][0],
            "service": rng.choice([4, 5, 6, 8]),
            "status": "pending",
        })

    return {
        "city": city_key,
        "city_name": c["name"],
        "center": c["center"],
        "zoom": c["zoom"],
        "depot": c["depot"],
        "shift_start": SHIFT_START_MIN,
        "vehicles": vehicles,
        "orders": orders,
        "traffic_zones": [],
        "seed": seed,
    }


def city_list():
    return [{"key": k, "name": v["name"], "center": v["center"], "zoom": v["zoom"]}
            for k, v in CITIES.items()]
