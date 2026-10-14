import io
import math
import os
import hashlib
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon, Circle

# Optional map package
try:
    import folium
    from streamlit_folium import st_folium
    MAP_AVAILABLE = True
except Exception:
    MAP_AVAILABLE = False


# ============================================================
# CONFIG
# ============================================================

st.set_page_config(
    page_title="AI Realty | Pune",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = Path(os.environ.get("REAL_ESTATE_DATA", BASE_DIR / "pune_real_estate_300.csv"))
LAYOUT_DIR = BASE_DIR / "layouts"
TOUR_DIR = BASE_DIR / "virtual_tours"
DOCUMENT_DIR = BASE_DIR / "documents"
for folder in (LAYOUT_DIR, TOUR_DIR, DOCUMENT_DIR):
    folder.mkdir(parents=True, exist_ok=True)

RATES = {
    "stamp_male": 0.07,
    "stamp_female": 0.06,
    "stamp_joint": 0.065,
    "registration_rate": 0.01,
    "registration_cap": 30000.0,
    "gst_affordable": 0.01,
    "gst_standard": 0.05,
    "affordable_value_limit": 4500000.0,
    "affordable_area_sqft": 645.835,
    "gst_land_factor": 2 / 3,
    "loan_emi_limit": 0.50,
}

LOCALITY_COORDS = {
    "Baner": (18.5590, 73.7868),
    "Wakad": (18.5986, 73.7636),
    "Hinjewadi": (18.5912, 73.7389),
    "Bavdhan": (18.5186, 73.7780),
    "Kothrud": (18.5074, 73.8077),
    "Koregaon Park": (18.5362, 73.8939),
    "Shivajinagar": (18.5308, 73.8470),
    "Wagholi": (18.5793, 73.9908),
    "Pimpri": (18.6298, 73.7997),
    "Katraj": (18.4529, 73.8652),
    "Mulshi": (18.5111, 73.5060),
    "Pirangut": (18.5074, 73.6820),
}

DOCUMENT_TYPES = [
    "RERA",
    "Occupancy Certificate (OC)",
    "Commencement Certificate (CC)",
    "7/12 Extract / Property Card",
    "Index-II",
    "Previous Sale Deed / Title Chain",
    "Encumbrance Certificate",
    "Sanctioned Building Plan",
    "Fire NOC",
    "Environment NOC",
    "AAI Height Clearance",
]


# ============================================================
# PROFESSIONAL UI
# ============================================================

st.markdown(
    """
    <style>
    .block-container { padding-top: 2rem; padding-bottom: 3rem; max-width: 1400px; }
    [data-testid="stSidebar"] { border-right: 1px solid #e8ebf0; }
    .brand { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.15rem; }
    .muted { color: #6b7280; font-size: 0.88rem; }
    .hero {
        padding: 2.4rem 2.5rem;
        border: 1px solid #e6eaf0;
        border-radius: 22px;
        background: linear-gradient(135deg, #ffffff 0%, #f7f9fc 100%);
        margin-bottom: 1.4rem;
    }
    .hero h1 { font-size: 2.45rem; line-height: 1.08; margin: 0 0 0.7rem 0; letter-spacing: -0.04em; }
    .hero p { color: #5f6875; font-size: 1.02rem; max-width: 760px; }
    .pill { display:inline-block; padding:0.32rem 0.68rem; border-radius:999px; background:#eef3ff; color:#334155; font-size:0.78rem; margin-right:0.35rem; }
    .card { border:1px solid #e6eaf0; border-radius:16px; padding:1.1rem; background:#fff; height:100%; }
    .card h3 { margin:0.15rem 0 0.35rem 0; font-size:1.05rem; }
    .price { font-size:1.45rem; font-weight:800; }
    .subtle-box { border:1px solid #e8ebf0; border-radius:14px; padding:1rem; background:#fafbfc; }
    .tour-note { border-left:4px solid #94a3b8; padding:0.7rem 0.9rem; background:#f8fafc; color:#475569; border-radius:4px; }
    .section-title { font-size:1.35rem; font-weight:750; margin-top:1rem; margin-bottom:0.6rem; }
    div[data-testid="stMetric"] { border: 1px solid #e7eaf0; padding: 0.8rem; border-radius: 13px; background: #fff; }
    </style>
    """,
    unsafe_allow_html=True,
)


def money(value):
    if value is None or pd.isna(value):
        return "₹0"
    value = float(value)
    if abs(value) >= 1e7:
        return f"₹{value / 1e7:.2f} Cr"
    if abs(value) >= 1e5:
        return f"₹{value / 1e5:.2f} L"
    if abs(value) >= 1e3:
        return f"₹{value / 1e3:.1f}K"
    return f"₹{value:,.0f}"


def money_full(value):
    if value is None or pd.isna(value):
        return "₹0"
    return f"₹{float(value):,.0f}"


def pct(value):
    return f"{float(value):.1f}%"


def safe_filename(value):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(value))


def stable_seed(value):
    return int(hashlib.md5(str(value).encode()).hexdigest()[:8], 16)


# ============================================================
# DATA + ML

@st.cache_data
def load_and_prepare_data(path_string):
    df = pd.read_csv(path_string)

    required = [
        "PropertyID", "PropertyName", "Location", "PropertyType",
        "ListingType", "BHK", "AreaSqFt", "Bathrooms", "ParkingSpaces",
        "AgeYears", "MetroDistanceKm", "ITParkDistanceKm",
        "MallDistanceKm", "SchoolDistanceKm", "HospitalDistanceKm",
        "TrafficIndex", "GreeneryIndex", "SecurityScore", "Furnishing",
        "Balconies", "AmenitiesScore", "Gym", "SwimmingPool",
        "Clubhouse", "Lift", "Price2022", "Price2023", "Price2024",
        "Price2025", "CurrentPrice", "DemandIndex", "SupplyIndex",
        "InfrastructureGrowthScore", "FutureGrowthScore",
        "RentalDemandScore", "UpcomingMetroImpact",
        "ExpectedShortTermGrowthPct", "RoadConnectivityScore",
        "CommercialDevelopment", "ResidentialDevelopment",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    categorical = ["PropertyID", "PropertyName", "Location", "PropertyType", "ListingType", "Furnishing"]
    numeric_cols = [c for c in required if c not in categorical]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        if df[col].isna().any():
            med = df[col].median()
            df[col] = df[col].fillna(0 if pd.isna(med) else med)

    df["PricePerSqFt"] = np.where(df["AreaSqFt"] > 0, df["CurrentPrice"] / df["AreaSqFt"], 0)
    df["HistoricalGrowthPct"] = np.where(
        df["Price2022"] > 0,
        ((df["CurrentPrice"] - df["Price2022"]) / df["Price2022"]) * 100,
        0,
    )

    development_features = [
        "InfrastructureGrowthScore", "FutureGrowthScore", "RentalDemandScore",
        "UpcomingMetroImpact", "RoadConnectivityScore", "CommercialDevelopment",
        "ResidentialDevelopment", "DemandIndex",
    ]
    development_average = df[development_features].mean(axis=1)
    df["DevelopmentRating"] = (development_average * 0.9).clip(0, 9)

    def calculate_trend(row):
        if row["HistoricalGrowthPct"] >= 25 and row["FutureGrowthScore"] >= 7:
            return "Increasing"
        if row["FutureGrowthScore"] >= 7 and row["DevelopmentRating"] >= 6:
            return "Increasing"
        if row["HistoricalGrowthPct"] < 10 and row["FutureGrowthScore"] <= 4:
            return "Declining"
        return "Stable"

    df["DevelopmentTrend"] = df.apply(calculate_trend, axis=1)

    features = [
        "Location", "PropertyType", "ListingType", "BHK", "AreaSqFt",
        "Bathrooms", "ParkingSpaces", "AgeYears", "MetroDistanceKm",
        "ITParkDistanceKm", "MallDistanceKm", "SchoolDistanceKm",
        "HospitalDistanceKm", "TrafficIndex", "GreeneryIndex", "SecurityScore",
        "Furnishing", "Balconies", "AmenitiesScore", "Gym", "SwimmingPool",
        "Clubhouse", "Lift", "Price2022", "Price2023", "Price2024", "Price2025",
        "DemandIndex", "SupplyIndex", "InfrastructureGrowthScore",
        "FutureGrowthScore", "RentalDemandScore", "UpcomingMetroImpact",
        "ExpectedShortTermGrowthPct", "RoadConnectivityScore",
        "CommercialDevelopment", "ResidentialDevelopment",
    ]
    categorical_features = ["Location", "PropertyType", "ListingType", "Furnishing"]

    X_train, X_test, y_train, y_test = train_test_split(
        df[features], df["CurrentPrice"], test_size=0.20, random_state=42
    )
    preprocessor = ColumnTransformer(
        transformers=[("categorical", OneHotEncoder(handle_unknown="ignore"), categorical_features)],
        remainder="passthrough",
    )
    model = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("random_forest", RandomForestRegressor(
            n_estimators=300, random_state=42, min_samples_leaf=2, n_jobs=-1
        )),
    ])
    model.fit(X_train, y_train)
    test_predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, test_predictions)
    rmse = np.sqrt(mean_squared_error(y_test, test_predictions))
    r2 = r2_score(y_test, test_predictions)

    df["AI_EstimatedValue"] = model.predict(df[features])
    df["PriceDifferencePct"] = np.where(
        df["AI_EstimatedValue"] != 0,
        ((df["CurrentPrice"] - df["AI_EstimatedValue"]) / df["AI_EstimatedValue"]) * 100,
        0,
    )
    df["FutureEstimatedPrice"] = df["CurrentPrice"] * (1 + df["ExpectedShortTermGrowthPct"] / 100)

    value_score = np.clip(50 - (df["PriceDifferencePct"] * 2), 0, 100)
    development_score = (df["DevelopmentRating"] / 9) * 100
    growth_score = np.clip(df["HistoricalGrowthPct"] / 50 * 100, 0, 100)
    future_growth_score = (df["FutureGrowthScore"] / 10) * 100
    demand_score = (df["DemandIndex"] / 10) * 100
    rental_score = (df["RentalDemandScore"] / 10) * 100

    df["InvestmentScore"] = (
        value_score * 0.30 + development_score * 0.20 + growth_score * 0.15
        + future_growth_score * 0.15 + demand_score * 0.10 + rental_score * 0.10
    ).clip(0, 100)

    def investment_decision(row):
        score = row["InvestmentScore"]
        growth = row["ExpectedShortTermGrowthPct"]
        difference = row["PriceDifferencePct"]
        trend = row["DevelopmentTrend"]
        if score >= 75 and difference <= 0:
            return "BUY NOW"
        if score >= 65 and growth >= 5 and trend == "Increasing":
            return "BUY / HOLD"
        if score >= 55:
            return "NEGOTIATE"
        if growth >= 5 and trend == "Increasing":
            return "WAIT"
        return "AVOID"

    df["Recommendation"] = df.apply(investment_decision, axis=1)
    df = df.sort_values("InvestmentScore", ascending=False).reset_index(drop=True)
    df["PropertyRank"] = np.arange(1, len(df) + 1)

    metrics = {
        "MAE": float(mae), "RMSE": float(rmse), "R2": float(r2),
        "train_size": len(X_train), "test_size": len(X_test), "features": len(features),
    }
    return df, model, metrics


def generate_agent_explanation(row):
    current = float(row["CurrentPrice"]); ai_value = float(row["AI_EstimatedValue"])
    diff = ((current - ai_value) / ai_value * 100) if ai_value else 0
    if diff <= -5:
        price_reason = f"Current price is {abs(diff):.1f}% below the AI estimated value."
    elif diff < 0:
        price_reason = f"Current price is {abs(diff):.1f}% below the AI estimated value."
    elif diff <= 2:
        price_reason = "Current price is close to the AI estimated value."
    else:
        price_reason = f"Current price is {diff:.1f}% above the AI estimated value."
    growth = float(row["HistoricalGrowthPct"])
    growth_reason = f"Historical growth is {growth:.1f}%."
    return " ".join([
        price_reason, growth_reason,
        f"Development rating is {float(row['DevelopmentRating']):.1f}/9.",
        f"Development trend is {str(row['DevelopmentTrend']).lower()}.",
        f"Expected short-term growth is {float(row['ExpectedShortTermGrowthPct']):.1f}%.",
        "Property demand is relatively high." if row["DemandIndex"] >= 8 else "Property demand is moderate." if row["DemandIndex"] >= 5 else "Property demand is relatively low.",
    ])


def future_advice(row):
    growth = row["ExpectedShortTermGrowthPct"]; trend = row["DevelopmentTrend"]
    if growth >= 8 and trend == "Increasing":
        return "The dataset indicates strong future-growth conditions. Review the current price and documents before making a decision."
    if growth >= 5 and trend == "Increasing":
        return "The dataset indicates positive future potential. Compare this property with alternatives."
    if growth >= 3:
        return "The dataset indicates moderate future growth. Consider other property and locality factors as well."
    return "The dataset indicates limited future-growth potential. Review other properties before deciding."


# ============================================================
# SEARCH + DOCUMENT HELPERS
# ============================================================

def apply_filters(df, budget=None, locations=None, min_bhk=None, property_type="Any", listing_type="Any", furnishing="Any"):
    out = df.copy()
    if budget is not None:
        out = out[out["CurrentPrice"] <= budget]
    if locations:
        out = out[out["Location"].isin(locations)]
    if min_bhk is not None:
        out = out[out["BHK"] >= min_bhk]
    if property_type != "Any":
        out = out[out["PropertyType"] == property_type]
    if listing_type != "Any":
        out = out[out["ListingType"] == listing_type]
    if furnishing != "Any":
        out = out[out["Furnishing"] == furnishing]
    return out.sort_values("InvestmentScore", ascending=False)


def document_status_path(property_id):
    return DOCUMENT_DIR / str(property_id)


def get_saved_documents(property_id):
    folder = document_status_path(property_id)
    if not folder.exists():
        return []
    return sorted([p.name for p in folder.iterdir() if p.is_file()])


def save_uploaded_document(property_id, uploaded_file):
    folder = document_status_path(property_id); folder.mkdir(parents=True, exist_ok=True)
    target = folder / Path(uploaded_file.name).name
    with open(target, "wb") as f:
        f.write(uploaded_file.getbuffer())
    return target


def run_document_consistency_check(row, document_property_id, document_location, document_area, document_price):
    flags = []
    if str(document_property_id).strip() != str(row["PropertyID"]):
        flags.append(("HIGH", "Property ID mismatch", f"Dataset ID is {row['PropertyID']} but document says {document_property_id}."))
    if document_location.strip().lower() != str(row["Location"]).strip().lower():
        flags.append(("MEDIUM", "Location mismatch", f"Dataset location is {row['Location']} but document says {document_location}."))
    area_difference = abs(float(document_area) - float(row["AreaSqFt"]))
    if area_difference > max(25, float(row["AreaSqFt"]) * 0.03):
        flags.append(("HIGH", "Area mismatch", f"Dataset area is {row['AreaSqFt']:.0f} sq ft but document says {document_area:.0f} sq ft."))
    price_difference = abs(float(document_price) - float(row["CurrentPrice"]))
    if price_difference > max(100000, float(row["CurrentPrice"]) * 0.05):
        flags.append(("MEDIUM", "Price mismatch", f"Dataset price is {money_full(row['CurrentPrice'])} but document says {money_full(document_price)}."))
    if not flags:
        flags.append(("LOW", "No mismatch found in supplied fields", "The supplied property ID, location, area and price are consistent with the dataset."))
    return flags


# ============================================================
# 2D LAYOUT ENGINE
# ============================================================

def design_family(row):
    ptype = str(row["PropertyType"]).lower()
    bhk = int(row["BHK"]); area = float(row["AreaSqFt"])
    if "villa" in ptype or "bungalow" in ptype:
        base = "villa"
    elif "row" in ptype:
        base = "rowhouse"
    elif "penthouse" in ptype:
        base = "penthouse"
    else:
        base = "apartment"
    area_bucket = int(round(area / 250.0) * 250)
    return f"{base}_{bhk}bhk_{area_bucket}"


def generate_layout(row, save=True):
    pid = str(row["PropertyID"]); seed = stable_seed(design_family(row))
    rng = np.random.default_rng(seed + stable_seed(pid) % 1000)
    bhk = max(1, int(row["BHK"])); baths = max(1, int(row["Bathrooms"])); balconies = max(0, int(row["Balconies"]))
    ptype = str(row["PropertyType"])
    fig, ax = plt.subplots(figsize=(11, 7))
    ax.set_xlim(0, 16); ax.set_ylim(0, 10); ax.set_aspect("equal"); ax.axis("off")

    def room(x, y, w, h, label):
        ax.add_patch(Rectangle((x, y), w, h, fill=False, linewidth=2.0))
        ax.text(x + w/2, y + h/2, label, ha="center", va="center", fontsize=9)

    # Same BHK/area family -> similar base layout; seed introduces modest variations.
    living_w = 4.6 + float(rng.choice([-0.2, 0, 0.2]))
    room(0.4, 0.5, living_w, 3.0, "LIVING / DINING")
    room(living_w + 0.4, 0.5, 3.2, 3.0, "KITCHEN")
    room(living_w + 3.6, 0.5, 2.7, 3.0, "BEDROOM 1")
    room(living_w + 6.3, 0.5, 3.2, 3.0, "BEDROOM 2" if bhk >= 2 else "STUDY")
    if bhk >= 3:
        room(0.4, 3.5, 4.0, 2.6, "MASTER BEDROOM")
        room(4.4, 3.5, 3.6, 2.6, "BEDROOM 3")
    else:
        room(0.4, 3.5, 4.0, 2.6, "BEDROOM / FLEX")
        room(4.4, 3.5, 3.6, 2.6, "DINING / STUDY")
    for i in range(min(baths, 3)):
        x = 8.0 + (i % 2) * 2.2; y = 3.5 + (i // 2) * 1.45
        room(x, y, 1.9, 1.2, f"BATH {i+1}")
    balcony_side = int(rng.integers(0, 3))
    if balconies > 0:
        if balcony_side == 0:
            room(0.4, 6.25, 4.0, 1.15, "BALCONY")
        elif balcony_side == 1:
            room(4.4, 6.25, 3.6, 1.15, "BALCONY")
        else:
            room(8.0, 6.25, 4.0, 1.15, "BALCONY")
    room(0.4, 7.55, 12.0, 1.0, "ENTRY / PASSAGE")
    title = f"Illustrative Layout — {pid} | {ptype} | {bhk} BHK | {int(row['AreaSqFt'])} sq ft"
    ax.text(6.4, 9.35, title, ha="center", fontsize=13, fontweight="bold")
    ax.text(6.4, 8.95, "Generated from property attributes • not a sanctioned architectural plan", ha="center", fontsize=8.5)
    fig.tight_layout()
    if save:
        path = LAYOUT_DIR / f"{safe_filename(pid)}.png"
        fig.savefig(path, dpi=160, bbox_inches="tight")
        plt.close(fig)
        return path
    return fig


def generate_all_layouts(df):
    count = 0
    for _, row in df.iterrows():
        path = LAYOUT_DIR / f"{safe_filename(row['PropertyID'])}.png"
        if not path.exists():
            generate_layout(row, save=True); count += 1
    return count


# ============================================================
# VIRTUAL TOUR RENDER ENGINE
# ============================================================

def room_style(row):
    furnishing = str(row["Furnishing"]).lower()
    if "fully" in furnishing:
        return "Fully furnished"
    if "semi" in furnishing:
        return "Semi furnished"
    return "Unfurnished / flexible"


def draw_room_render(row, room_name, frame_index, save_path):
    family = design_family(row)
    seed = stable_seed(family) + stable_seed(str(row["PropertyID"])) % 10000
    rng = np.random.default_rng(seed)
    fig, ax = plt.subplots(figsize=(12, 6.7))
    ax.set_xlim(0, 12); ax.set_ylim(0, 7); ax.axis("off")

    # Minimal architectural palette; deliberately not photorealistic.
    ax.add_patch(Rectangle((0, 0), 12, 7, facecolor="#f7f7f5", edgecolor="none"))
    ax.add_patch(Polygon([[0, 0], [12, 0], [10.7, 1.2], [1.3, 1.2]], closed=True, facecolor="#e8e2d8", edgecolor="none"))
    ax.add_patch(Polygon([[0, 7], [12, 7], [10.7, 5.9], [1.3, 5.9]], closed=True, facecolor="#fafaf8", edgecolor="none"))
    ax.add_patch(Polygon([[0, 0], [1.3, 1.2], [1.3, 5.9], [0, 7]], closed=True, facecolor="#ece9e3", edgecolor="none"))
    ax.add_patch(Polygon([[12, 0], [10.7, 1.2], [10.7, 5.9], [12, 7]], closed=True, facecolor="#e5e1da", edgecolor="none"))
    ax.add_patch(Polygon([[1.3, 1.2], [10.7, 1.2], [10.7, 5.9], [1.3, 5.9]], closed=True, facecolor="#ffffff", edgecolor="#d8d8d4", linewidth=1.2))

    # Window placement changes slightly by property/variant.
    window_side = int(rng.integers(0, 3))
    if window_side == 0 or frame_index == 0:
        ax.add_patch(Rectangle((6.8, 3.15), 2.6, 2.0, facecolor="#dce9f1", edgecolor="#8da2af", linewidth=2))
        ax.plot([8.1, 8.1], [3.15, 5.15], linewidth=1.5)
    else:
        ax.add_patch(Rectangle((2.0, 3.15), 2.4, 2.0, facecolor="#dce9f1", edgecolor="#8da2af", linewidth=2))
        ax.plot([3.2, 3.2], [3.15, 5.15], linewidth=1.5)

    style = room_style(row)
    rn = room_name.lower()
    if "living" in rn:
        ax.add_patch(Rectangle((2.2, 1.55), 4.1, 1.0, facecolor="#d6d0c8", edgecolor="#777", linewidth=1.2))
        ax.add_patch(Rectangle((3.0, 2.35), 2.5, 0.35, facecolor="#777", edgecolor="none"))
        ax.add_patch(Rectangle((7.0, 1.5), 1.9, 0.25, facecolor="#b9b2a9", edgecolor="none"))
        ax.text(6, 6.25, "Living Room", ha="center", fontsize=22, fontweight="bold")
    elif "kitchen" in rn:
        ax.add_patch(Rectangle((1.7, 1.45), 7.6, 0.7, facecolor="#d9d9d4", edgecolor="#777"))
        ax.add_patch(Rectangle((4.2, 2.35), 3.0, 0.65, facecolor="#ecebe7", edgecolor="#777"))
        for x in [2.2, 3.3, 7.8, 8.7]:
            ax.add_patch(Circle((x, 2.0), 0.12, facecolor="#777", edgecolor="none"))
        ax.text(6, 6.25, "Kitchen", ha="center", fontsize=22, fontweight="bold")
    elif "bed" in rn:
        ax.add_patch(Rectangle((3.0, 1.5), 4.5, 2.7, facecolor="#ddd6ce", edgecolor="#777", linewidth=1.3))
        ax.add_patch(Rectangle((3.35, 3.65), 3.8, 0.25, facecolor="#f2f0eb", edgecolor="none"))
        ax.add_patch(Rectangle((8.2, 1.6), 1.0, 1.0, facecolor="#c8c1b8", edgecolor="#777"))
        ax.text(6, 6.25, room_name, ha="center", fontsize=22, fontweight="bold")
    elif "balcony" in rn:
        ax.add_patch(Rectangle((1.6, 1.25), 8.7, 0.35, facecolor="#aaa49d", edgecolor="none"))
        ax.add_patch(Rectangle((2.0, 1.7), 0.25, 3.5, facecolor="#a4a8aa", edgecolor="none"))
        ax.add_patch(Rectangle((9.7, 1.7), 0.25, 3.5, facecolor="#a4a8aa", edgecolor="none"))
        ax.add_patch(Circle((6.0, 2.5), 0.55, facecolor="#c7bcae", edgecolor="#777"))
        ax.text(6, 6.25, "Balcony", ha="center", fontsize=22, fontweight="bold")
    else:
        ax.add_patch(Rectangle((3.0, 1.5), 6.0, 0.6, facecolor="#d7d3cd", edgecolor="#777"))
        ax.text(6, 6.25, room_name, ha="center", fontsize=22, fontweight="bold")

    ax.text(0.55, 0.45, f"{row['PropertyName']}  •  {row['BHK']} BHK  •  {int(row['AreaSqFt'])} sq ft", fontsize=9.5, color="#4b5563")
    ax.text(11.45, 0.45, style, fontsize=9.5, color="#4b5563", ha="right")
    fig.tight_layout(pad=0.2)
    fig.savefig(save_path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def tour_rooms(row):
    ptype = str(row["PropertyType"]).lower()
    rooms = ["Living Room", "Kitchen"]
    if int(row["BHK"]) >= 1:
        rooms.append("Master Bedroom")
    if int(row["BHK"]) >= 2:
        rooms.append("Bedroom 2")
    if int(row["Balconies"]) > 0:
        rooms.append("Balcony")
    if "villa" in ptype or "bungalow" in ptype:
        rooms.insert(0, "Exterior")
    return rooms[:5]


def generate_virtual_tour(row):
    pid = safe_filename(row["PropertyID"]); folder = TOUR_DIR / pid; folder.mkdir(parents=True, exist_ok=True)
    rooms = tour_rooms(row); frames = []
    for i, room_name in enumerate(rooms):
        path = folder / f"frame_{i}.png"
        if not path.exists():
            draw_room_render(row, room_name, i, path)
        frames.append(path)
    mp4 = folder / "virtual_tour.mp4"
    if not mp4.exists() and shutil.which("ffmpeg"):
        # ffmpeg is used only to assemble our deterministic illustrative frames.
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", "0.7",
            "-i", str(folder / "frame_%d.png"), "-vf", "scale=1280:-2", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)
        ], check=False)
    return mp4 if mp4.exists() else frames[0], frames


# ============================================================
# MAP + COSTS
# ============================================================

def show_property_map(row):
    location = str(row["Location"]); center = LOCALITY_COORDS.get(location)
    if center is None:
        st.warning("No approximate coordinates are configured for this locality.")
        return
    if not MAP_AVAILABLE:
        st.info("Install folium and streamlit-folium to enable the interactive map.")
        st.map(pd.DataFrame({"lat": [center[0]], "lon": [center[1]]}))
        return
    fmap = folium.Map(location=center, zoom_start=13, control_scale=True)
    folium.Marker(
        center, tooltip=f"{row['PropertyName']} — {location}",
        popup=f"{row['PropertyName']}<br>Locality: {location}<br>Approximate locality center",
        icon=folium.Icon(icon="home"),
    ).add_to(fmap)
    st_folium(fmap, width=None, height=430)


def calculate_hidden_cost(property_value, buyer_type, construction_status, affordable_housing, ready_reckoner_value):
    base_value = max(float(property_value), float(ready_reckoner_value))
    stamp_rate = RATES["stamp_male"] if buyer_type == "Male" else RATES["stamp_female"] if buyer_type == "Female" else RATES["stamp_joint"]
    stamp_duty = base_value * stamp_rate
    registration = min(base_value * RATES["registration_rate"], RATES["registration_cap"])
    gst = 0.0
    if construction_status == "Under Construction":
        gst_rate = RATES["gst_affordable"] if affordable_housing else RATES["gst_standard"]
        gst = base_value * RATES["gst_land_factor"] * gst_rate
    total = base_value + stamp_duty + registration + gst
    return {"Base Value": base_value, "Stamp Duty": stamp_duty, "Registration": registration, "GST": gst, "Total Estimated Cost": total}


def calculate_emi(principal, annual_rate, years):
    if principal <= 0 or years <= 0:
        return 0.0
    monthly_rate = annual_rate / 12 / 100; months = years * 12
    if monthly_rate == 0:
        return principal / months
    return principal * monthly_rate * (1 + monthly_rate) ** months / ((1 + monthly_rate) ** months - 1)


# ============================================================
# LOAD DATA
# ============================================================

if not DATA_PATH.exists():
    st.error(f"CSV not found at {DATA_PATH}. Upload pune_real_estate_300.csv beside app.py.")
    st.stop()

try:
    df, model, metrics = load_and_prepare_data(str(DATA_PATH))
except Exception as e:
    st.error(f"Could not load/train the project: {e}")
    st.stop()


# ============================================================
# SESSION STATE + SIDEBAR
# ============================================================

if "page" not in st.session_state:
    st.session_state.page = "Home"
if "quick_budget" not in st.session_state:
    st.session_state.quick_budget = float(df["CurrentPrice"].median())
if "quick_locations" not in st.session_state:
    st.session_state.quick_locations = []
if "quick_bhk" not in st.session_state:
    st.session_state.quick_bhk = 2
if "quick_type" not in st.session_state:
    st.session_state.quick_type = "Any"

with st.sidebar:
    st.markdown('<div class="brand">🏠 AI Realty</div>', unsafe_allow_html=True)
    st.markdown('<div class="muted">Pune Property Intelligence</div>', unsafe_allow_html=True)
    st.markdown("---")
    page = st.radio(
        "Explore",
        ["Home", "Property Search", "Property Details", "Documents & Risk", "2D Layout", "Virtual Tour", "Map & Facilities", "Hidden Cost & EMI", "Market Intelligence", "ML Model"],
        index=["Home", "Property Search", "Property Details", "Documents & Risk", "2D Layout", "Virtual Tour", "Map & Facilities", "Hidden Cost & EMI", "Market Intelligence", "ML Model"].index(st.session_state.page),
    )
    st.session_state.page = page

    st.markdown("### Quick preferences")
    st.caption("Set these once; use them to narrow properties quickly.")
    st.session_state.quick_budget = st.number_input(
        "Budget up to (₹)", min_value=0.0, value=float(st.session_state.quick_budget), step=500000.0, format="%.0f"
    )
    st.session_state.quick_locations = st.multiselect(
        "Preferred locality", sorted(df["Location"].unique()), default=st.session_state.quick_locations
    )
    st.session_state.quick_bhk = st.number_input(
        "Minimum BHK", min_value=1, max_value=int(df["BHK"].max()), value=int(st.session_state.quick_bhk)
    )
    st.session_state.quick_type = st.selectbox(
        "Property type", ["Any"] + sorted(df["PropertyType"].unique()), index=(["Any"] + sorted(df["PropertyType"].unique())).index(st.session_state.quick_type) if st.session_state.quick_type in ["Any"] + sorted(df["PropertyType"].unique()) else 0
    )
    if st.button("Find matching homes", use_container_width=True):
        st.session_state.page = "Property Search"
        st.rerun()
    st.markdown("---")
    st.caption(f"{len(df)} properties • {df['Location'].nunique()} Pune localities")
    st.caption("Stage 1 • AI-assisted prototype")


# ============================================================
# HOME — SIMPLE INTRO PAGE
# ============================================================

if page == "Home":
    st.markdown(
        """
        <div class="hero">
            <span class="pill">PUNE</span><span class="pill">AI VALUATION</span><span class="pill">PROPERTY INTELLIGENCE</span>
            <h1>Find a property with more clarity.</h1>
            <p>Search Pune homes, compare asking price with an AI-estimated value, understand locality factors, check documents and explore an illustrative virtual tour.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown("### What are you looking for?")
    q1, q2, q3 = st.columns([2, 1, 1])
    with q1:
        home_locations = st.multiselect("Locality", sorted(df["Location"].unique()), default=st.session_state.quick_locations, key="home_locations")
    with q2:
        home_bhk = st.selectbox("BHK", ["Any"] + list(range(1, int(df["BHK"].max()) + 1)), index=0, key="home_bhk")
    with q3:
        home_budget = st.number_input("Budget up to (₹)", min_value=0.0, value=float(st.session_state.quick_budget), step=500000.0, key="home_budget")
    if st.button("Search properties", type="primary", use_container_width=True):
        st.session_state.quick_locations = home_locations
        st.session_state.quick_bhk = 1 if home_bhk == "Any" else int(home_bhk)
        st.session_state.quick_budget = home_budget
        st.session_state.page = "Property Search"
        st.rerun()

    st.markdown("### Explore the platform")
    features = [
        ("🤖", "AI Valuation", "Compare the listed price with the model's estimated property value."),
        ("📐", "2D + Virtual Tour", "Explore an illustrative layout and an inside-property walkthrough."),
        ("🗺️", "Location Intelligence", "See locality position and available facility-distance data."),
        ("📄", "Documents & Risk", "Upload documents and check supplied fields for inconsistencies."),
    ]
    cols = st.columns(4)
    for col, (icon, title, desc) in zip(cols, features):
        with col:
            st.markdown(f'<div class="card"><div style="font-size:1.5rem">{icon}</div><h3>{title}</h3><div class="muted">{desc}</div></div>', unsafe_allow_html=True)

    st.markdown("### Featured properties")
    featured = df.head(4)
    cols = st.columns(4)
    for col, (_, row) in zip(cols, featured.iterrows()):
        with col:
            st.markdown(
                f'<div class="card"><div class="muted">{row["Location"]} • {int(row["BHK"])} BHK</div><h3>{row["PropertyName"]}</h3><div class="price">{money(row["CurrentPrice"])}</div><div class="muted">AI value {money(row["AI_EstimatedValue"])} • Score {row["InvestmentScore"]:.1f}</div></div>',
                unsafe_allow_html=True,
            )

    st.markdown('<div class="tour-note"><b>Visualization note:</b> Virtual tours and generated layouts are illustrative. They are not photographs, sanctioned plans, or guaranteed representations of an actual interior.</div>', unsafe_allow_html=True)


# ============================================================
# PROPERTY SEARCH
# ============================================================

elif page == "Property Search":
    st.title("Find your property")
    st.caption("Use the saved preferences from the sidebar, or refine them here.")
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        budget = st.number_input("Budget up to (₹)", min_value=0.0, value=float(st.session_state.quick_budget), step=500000.0)
    with c2:
        locations = st.multiselect("Localities", sorted(df["Location"].unique()), default=st.session_state.quick_locations)
    with c3:
        min_bhk = st.number_input("Minimum BHK", min_value=1, max_value=int(df["BHK"].max()), value=int(st.session_state.quick_bhk))
    with c4:
        ptype = st.selectbox("Property type", ["Any"] + sorted(df["PropertyType"].unique()), index=0)
    c5, c6 = st.columns(2)
    with c5:
        listing = st.selectbox("Listing type", ["Any"] + sorted(df["ListingType"].unique()))
    with c6:
        furnishing = st.selectbox("Furnishing", ["Any"] + sorted(df["Furnishing"].unique()))

    results = apply_filters(df, budget, locations, min_bhk, ptype, listing, furnishing)
    st.success(f"{len(results)} properties match your preferences.")
    if not results.empty:
        for _, row in results.head(20).iterrows():
            with st.container(border=True):
                left, mid, right = st.columns([4, 2, 1.2])
                with left:
                    st.markdown(f"**{row['PropertyName']}**")
                    st.caption(f"{row['PropertyID']} • {row['Location']} • {row['PropertyType']} • {int(row['BHK'])} BHK • {int(row['AreaSqFt'])} sq ft")
                with mid:
                    st.markdown(f"**{money(row['CurrentPrice'])}**")
                    st.caption(f"AI value {money(row['AI_EstimatedValue'])}")
                with right:
                    st.metric("Score", f"{row['InvestmentScore']:.1f}")
    else:
        st.info("No property matches all selected preferences. Try a wider budget or locality selection.")


# ============================================================
# PROPERTY DETAILS
# ============================================================

elif page == "Property Details":
    st.title("Property profile")
    selected_id = st.selectbox("Select property", df["PropertyID"].tolist(), format_func=lambda x: f"{x} — {df.loc[df['PropertyID'].eq(x), 'PropertyName'].iloc[0]}")
    row = df.loc[df["PropertyID"] == selected_id].iloc[0]
    st.markdown(f"## {row['PropertyName']}")
    st.caption(f"{row['Location']} • {row['PropertyType']} • {int(row['BHK'])} BHK • {int(row['AreaSqFt'])} sq ft")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Current price", money(row["CurrentPrice"]))
    c2.metric("AI estimated value", money(row["AI_EstimatedValue"]))
    c3.metric("Investment score", f"{row['InvestmentScore']:.1f}/100")
    c4.metric("Property rank", f"#{int(row['PropertyRank'])}")

    tabs = st.tabs(["Overview", "AI Valuation", "Layout & Tour", "Location", "Documents & Risk", "Costs"])
    with tabs[0]:
        a, b, c = st.columns(3)
        a.metric("Bathrooms", int(row["Bathrooms"])); b.metric("Parking", int(row["ParkingSpaces"])); c.metric("Balconies", int(row["Balconies"]))
        st.markdown("### Property snapshot")
        st.dataframe(pd.DataFrame({
            "Feature": ["Location", "Type", "Listing", "BHK", "Area", "Furnishing", "Age", "Price / sq ft"],
            "Value": [row["Location"], row["PropertyType"], row["ListingType"], int(row["BHK"]), f"{int(row['AreaSqFt'])} sq ft", row["Furnishing"], f"{int(row['AgeYears'])} years", money(row["PricePerSqFt"])],
        }), use_container_width=True, hide_index=True)
        st.info(generate_agent_explanation(row))
    with tabs[1]:
        d1, d2, d3 = st.columns(3)
        d1.metric("Current", money(row["CurrentPrice"]))
        d2.metric("AI estimate", money(row["AI_EstimatedValue"]))
        d3.metric("Difference", pct(row["PriceDifferencePct"]))
        st.markdown("### Why the model differs")
        st.write(generate_agent_explanation(row))
        st.caption("AI Estimated Value is a model output from the supplied dataset; it is not an official valuation or a guarantee of future price.")
    with tabs[2]:
        if st.button("Open 2D layout", key="detail_layout"):
            st.session_state.page = "2D Layout"; st.session_state.layout_property_id = selected_id; st.rerun()
        if st.button("Open virtual tour", key="detail_tour"):
            st.session_state.page = "Virtual Tour"; st.session_state.tour_property_id = selected_id; st.rerun()
    with tabs[3]:
        show_property_map(row)
        st.write({"Metro": f"{row['MetroDistanceKm']:.2f} km", "IT Park": f"{row['ITParkDistanceKm']:.2f} km", "Mall": f"{row['MallDistanceKm']:.2f} km", "School": f"{row['SchoolDistanceKm']:.2f} km", "Hospital": f"{row['HospitalDistanceKm']:.2f} km"})
    with tabs[4]:
        st.warning("Prototype document checks are not legal verification. Professional/legal verification is required before a real transaction.")
        saved = get_saved_documents(selected_id)
        st.write(f"Uploaded documents: {len(saved)}")
        if saved:
            st.write(" • ".join(saved))
    with tabs[5]:
        st.write(f"Estimated total cost tools are available in **Hidden Cost & EMI**.")
        if st.button("Open cost calculator", key="detail_cost"):
            st.session_state.page = "Hidden Cost & EMI"; st.session_state.cost_property_id = selected_id; st.rerun()


# ============================================================
# DOCUMENTS + RISK
# ============================================================

elif page == "Documents & Risk":
    st.title("Documents & risk")
    selected_id = st.selectbox("Select property", df["PropertyID"].tolist(), key="doc_property")
    row = df.loc[df["PropertyID"] == selected_id].iloc[0]
    st.warning("Document statuses in this prototype are not legal verification. Only independently verified documents should be relied upon for a real transaction.")
    st.subheader("Document checklist")
    saved_docs = get_saved_documents(selected_id)
    checklist = pd.DataFrame({"Document": DOCUMENT_TYPES, "Status": ["Uploaded" if any(d.lower().startswith(t.split()[0].lower()) for d in saved_docs) else "Not provided" for t in DOCUMENT_TYPES]})
    st.dataframe(checklist, use_container_width=True, hide_index=True)
    uploaded = st.file_uploader("Upload documents", type=["pdf", "png", "jpg", "jpeg", "doc", "docx"], accept_multiple_files=True)
    if uploaded:
        for file in uploaded:
            saved = save_uploaded_document(selected_id, file); st.success(f"Saved: {saved.name}")
    st.markdown("### Consistency checker")
    st.caption("This checks supplied fields against the dataset; it does not prove fraud or document authenticity.")
    c1, c2 = st.columns(2)
    with c1:
        doc_pid = st.text_input("Property ID on document", value=str(row["PropertyID"]))
        doc_location = st.text_input("Location on document", value=str(row["Location"]))
    with c2:
        doc_area = st.number_input("Area on document (sq ft)", min_value=0.0, value=float(row["AreaSqFt"]))
        doc_price = st.number_input("Price/value on document (₹)", min_value=0.0, value=float(row["CurrentPrice"]), step=10000.0)
    if st.button("Run consistency check", type="primary"):
        for severity, title, description in run_document_consistency_check(row, doc_pid, doc_location, doc_area, doc_price):
            if severity == "HIGH": st.error(f"🔴 {title}: {description}")
            elif severity == "MEDIUM": st.warning(f"🟠 {title}: {description}")
            else: st.success(f"🟢 {title}: {description}")


# ============================================================
# 2D LAYOUT
# ============================================================

elif page == "2D Layout":
    st.title("2D floor-plan visualization")
    default_id = st.session_state.get("layout_property_id", df["PropertyID"].iloc[0])
    ids = df["PropertyID"].tolist(); default_index = ids.index(default_id) if default_id in ids else 0
    selected_id = st.selectbox("Select property", ids, index=default_index, key="layout_property")
    row = df.loc[df["PropertyID"] == selected_id].iloc[0]
    st.info("This is an illustrative layout generated from BHK, area, bathroom and balcony attributes. It is not a sanctioned architectural plan.")
    path = LAYOUT_DIR / f"{safe_filename(selected_id)}.png"
    if st.button("Generate / refresh layout", type="primary"):
        path = generate_layout(row, save=True)
    if not path.exists():
        path = generate_layout(row, save=True)
    st.image(str(path), caption=f"Illustrative layout • {row['PropertyName']}", use_container_width=True)
    st.markdown(f"**Design family:** `{design_family(row)}`")
    st.caption("Properties with the same BHK/area/type family reuse a consistent base design; property-specific seeds can vary balcony/window placement.")
    st.markdown("### Generate missing layouts")
    if st.button("Generate layouts for all properties"):
        with st.spinner("Generating layouts..."):
            count = generate_all_layouts(df)
        st.success(f"Generated {count} new layouts. Existing layouts were kept.")


# ============================================================
# VIRTUAL TOUR
# ============================================================

elif page == "Virtual Tour":
    st.title("Illustrative virtual tour")
    default_id = st.session_state.get("tour_property_id", df["PropertyID"].iloc[0])
    ids = df["PropertyID"].tolist(); default_index = ids.index(default_id) if default_id in ids else 0
    selected_id = st.selectbox("Select property", ids, index=default_index, key="tour_property")
    row = df.loc[df["PropertyID"] == selected_id].iloc[0]
    st.markdown(f"## {row['PropertyName']}")
    st.caption(f"{row['Location']} • {row['PropertyType']} • {int(row['BHK'])} BHK • {int(row['AreaSqFt'])} sq ft")
    st.markdown("""<div class="tour-note"><b>What this is:</b> an AI-assisted/procedural illustrative interior concept generated from the property's BHK, area, type, furnishing and balcony attributes. It is not an actual photograph, scan, sanctioned plan or guaranteed representation of the property.</div>""", unsafe_allow_html=True)
    if st.button("Generate virtual tour", type="primary"):
        with st.spinner("Creating the illustrative walkthrough..."):
            tour_file, frames = generate_virtual_tour(row)
        st.session_state.last_tour = str(tour_file)
    tour_file = Path(st.session_state.get("last_tour", "")) if st.session_state.get("last_tour") else None
    if tour_file and tour_file.exists() and tour_file.suffix == ".mp4":
        st.video(str(tour_file))
    else:
        if tour_file and tour_file.exists():
            st.image(str(tour_file), use_container_width=True)
        st.info("Click Generate virtual tour to create the room-by-room walkthrough.")
    if st.session_state.get("last_tour"):
        folder = Path(st.session_state.last_tour).parent
        frame_paths = sorted(folder.glob("frame_*.png"))
        if frame_paths:
            st.markdown("### Tour stops")
            cols = st.columns(min(5, len(frame_paths)))
            for col, fp in zip(cols, frame_paths):
                with col:
                    st.image(str(fp), use_container_width=True)
    st.caption(f"Design family: {design_family(row)} — same family properties share a consistent visual base, while windows/balconies and other small details can vary.")


# ============================================================
# MAP + FACILITIES
# ============================================================

elif page == "Map & Facilities":
    st.title("Location intelligence")
    selected_id = st.selectbox("Select property", df["PropertyID"].tolist(), key="map_property")
    row = df.loc[df["PropertyID"] == selected_id].iloc[0]
    st.subheader(f"{row['PropertyName']} — {row['Location']}")
    show_property_map(row)
    facility_data = pd.DataFrame({
        "Facility": ["Metro", "IT Park", "Mall", "School", "Hospital"],
        "Distance (km)": [row["MetroDistanceKm"], row["ITParkDistanceKm"], row["MallDistanceKm"], row["SchoolDistanceKm"], row["HospitalDistanceKm"]],
    }).sort_values("Distance (km)")
    st.markdown("### Nearby facility distances")
    st.dataframe(facility_data, use_container_width=True, hide_index=True)
    st.caption("The dataset contains facility distances but not exact facility coordinates. The map therefore uses the configured approximate locality center and does not invent exact facility markers.")


# ============================================================
# COST + EMI
# ============================================================

elif page == "Hidden Cost & EMI":
    st.title("Total cost & EMI")
    ids = ["Manual"] + df["PropertyID"].tolist()
    default_id = st.session_state.get("cost_property_id", "Manual")
    default_index = ids.index(default_id) if default_id in ids else 0
    selected_id = st.selectbox("Property", ids, index=default_index, key="cost_property")
    if selected_id == "Manual":
        property_price = st.number_input("Property agreement value (₹)", min_value=0.0, value=8000000.0, step=100000.0)
    else:
        row = df.loc[df["PropertyID"] == selected_id].iloc[0]; property_price = float(row["CurrentPrice"])
        st.info(f"{row['PropertyName']} • {money(property_price)}")
    c1, c2, c3 = st.columns(3)
    with c1: buyer_type = st.selectbox("Buyer type", ["Male", "Female", "Joint male-female"])
    with c2: construction_status = st.selectbox("Construction status", ["Ready to move / OC", "Under Construction"])
    with c3: affordable = st.checkbox("Affordable housing category", value=False)
    rr_value = st.number_input("Ready Reckoner / applicable value (₹)", min_value=0.0, value=float(property_price), step=100000.0)
    if st.button("Calculate total acquisition cost", type="primary"):
        result = calculate_hidden_cost(property_price, buyer_type, construction_status, affordable, rr_value)
        a, b, c, d = st.columns(4)
        a.metric("Base value", money(result["Base Value"])); b.metric("Stamp duty", money(result["Stamp Duty"])); c.metric("Registration", money(result["Registration"])); d.metric("GST", money(result["GST"]))
        st.success(f"Estimated total acquisition cost: {money(result['Total Estimated Cost'])}")
        st.caption("Prototype calculator only. Rates and applicability must be verified for the actual transaction.")
    st.markdown("---")
    st.title("🏦 EMI & affordability")
    a, b, c = st.columns(3)
    with a: loan_amount = st.number_input("Loan amount (₹)", min_value=0.0, value=5000000.0, step=100000.0)
    with b: annual_rate = st.number_input("Interest rate (% p.a.)", min_value=0.0, max_value=30.0, value=8.5, step=0.1)
    with c: tenure = st.number_input("Tenure (years)", min_value=1, max_value=40, value=20)
    st.metric("Estimated monthly EMI", money(calculate_emi(loan_amount, annual_rate, tenure)))
    income = st.number_input("Net monthly income (₹)", min_value=0.0, value=100000.0, step=5000.0)
    st.info(f"Illustrative configured EMI ceiling: {money(income * RATES['loan_emi_limit'])} / month ({RATES['loan_emi_limit']*100:.0f}% of net income).")


# ============================================================
# MARKET INTELLIGENCE
# ============================================================

elif page == "Market Intelligence":
    st.title("Pune market intelligence")
    st.caption("Analytics are kept here rather than on the landing page so the product starts simple.")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Properties", len(df)); c2.metric("Localities", df["Location"].nunique()); c3.metric("Average price", money(df["CurrentPrice"].mean())); c4.metric("Average AI value", money(df["AI_EstimatedValue"].mean()))
    st.markdown("### Highest investment scores")
    show = df[["PropertyRank", "PropertyID", "PropertyName", "Location", "BHK", "CurrentPrice", "AI_EstimatedValue", "InvestmentScore", "Recommendation"]].head(10).copy()
    show["CurrentPrice"] = show["CurrentPrice"].map(money)
    show["AI_EstimatedValue"] = show["AI_EstimatedValue"].map(money)
    show["InvestmentScore"] = show["InvestmentScore"].map(lambda x: f"{x:.1f}")
    st.dataframe(show, use_container_width=True, hide_index=True)
    st.markdown("### Properties by locality")
    st.bar_chart(df["Location"].value_counts())
    st.markdown("### Model performance")
    a, b, c = st.columns(3); a.metric("R²", f"{metrics['R2']:.4f}"); b.metric("MAE", money(metrics["MAE"])); c.metric("RMSE", money(metrics["RMSE"]))


# ============================================================
# ML MODEL
# ============================================================

elif page == "ML Model":
    st.title("Model details")
    a, b, c = st.columns(3); a.metric("R²", f"{metrics['R2']:.4f}"); b.metric("MAE", money(metrics["MAE"])); c.metric("RMSE", money(metrics["RMSE"]))
    st.write(f"Training properties: **{metrics['train_size']}**")
    st.write(f"Testing properties: **{metrics['test_size']}**")
    st.write(f"Model features: **{metrics['features']}**")
    st.code("RandomForestRegressor(n_estimators=300, random_state=42, min_samples_leaf=2)")
    st.write("Train/test split: 80% training / 20% testing, random_state = 42.")
    st.info("AI Estimated Value is a model output from the supplied dataset. It is not an official market valuation or a guaranteed future price.")
