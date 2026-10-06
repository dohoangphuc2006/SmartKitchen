"""Smart Kitchen & Pantry Assistant - giao diện Streamlit.
Chạy:  streamlit run app.py
"""
from datetime import date, timedelta

import pandas as pd
import streamlit as st
from PIL import Image

from core import favorites, llm
from core.ingredients import INGREDIENTS, default_shelf_days, vi_name
from core.recommender import recommend

st.set_page_config(page_title="Smart Kitchen Assistant", page_icon="🍳", layout="wide")
st.title("🍳 Smart Kitchen & Pantry Assistant")
st.caption("Chụp tủ lạnh → nhận diện nguyên liệu → theo dõi hạn dùng → gợi ý món giảm lãng phí thực phẩm")

VI2KEY = {v[0]: k for k, v in INGREDIENTS.items()}
ALL_VI = sorted(VI2KEY)

if "pantry" not in st.session_state:
    st.session_state.pantry = pd.DataFrame(columns=["Nguyên liệu", "Số lượng", "Hạn dùng"])
if "results" not in st.session_state:
    st.session_state.results = None


def to_df(items):
    rows = [{"Nguyên liệu": vi_name(i["name"]), "Số lượng": i["count"],
             "Hạn dùng": date.today() + timedelta(days=default_shelf_days(i["name"]))} for i in items]
    return pd.DataFrame(rows, columns=["Nguyên liệu", "Số lượng", "Hạn dùng"])


tab1, tab2, tab3 = st.tabs(["📷 Tủ lạnh của tôi", "👨‍🍳 Gợi ý món", "⭐ Yêu thích"])

with tab1:
    c1, c2 = st.columns([1, 1])
    with c1:
        up = st.file_uploader("Tải ảnh tủ lạnh / nguyên liệu", type=["jpg", "jpeg", "png", "webp"])
        conf = st.slider("Ngưỡng tin cậy", 0.1, 0.9, 0.3, 0.05)
        if up is not None:
            img = Image.open(up).convert("RGB")
            if st.button("🔍 Nhận diện nguyên liệu", type="primary"):
                from core.detector import detect
                with st.spinner("Đang nhận diện..."):
                    items, annotated = detect(img, conf=conf)
                st.session_state.annotated = annotated
                st.session_state.pantry = to_df(items)
                if not items:
                    st.warning("Không phát hiện nguyên liệu nào. Thử giảm ngưỡng tin cậy.")
            st.image(st.session_state.get("annotated", img), use_container_width=True)
    with c2:
        st.subheader("Danh sách nguyên liệu (chỉnh sửa nhanh)")
        st.caption("Sửa số lượng, hạn dùng; thêm dòng mới hoặc xóa dòng bị nhận diện sai.")
        edited = st.data_editor(
            st.session_state.pantry, num_rows="dynamic", use_container_width=True, key="editor",
            column_config={
                "Nguyên liệu": st.column_config.SelectboxColumn(options=ALL_VI, required=True),
                "Số lượng": st.column_config.NumberColumn(min_value=1, step=1, default=1),
                "Hạn dùng": st.column_config.DateColumn(required=True, default=date.today() + timedelta(days=7)),
            })
        st.session_state.pantry = edited
        if len(edited):
            exp = edited.dropna(subset=["Nguyên liệu", "Hạn dùng"]).copy()
            exp["Còn (ngày)"] = exp["Hạn dùng"].apply(lambda d: (d - date.today()).days)
            warn = exp[exp["Còn (ngày)"] <= 3].sort_values("Còn (ngày)")
            if len(warn):
                st.warning("⏰ Sắp hết hạn / đã hết hạn:\n" + "\n".join(
                    f"- **{r['Nguyên liệu']}**: " + ("đã quá hạn" if r["Còn (ngày)"] < 0 else f"còn {r['Còn (ngày)']} ngày")
                    for _, r in warn.iterrows()))

with tab2:
    servings = st.number_input("Khẩu phần (số người)", 1, 12, 2)
    topk = st.slider("Số món gợi ý", 3, 15, 8)
    pref = st.text_input("Yêu cầu thêm cho AI (tùy chọn, ví dụ: ít dầu mỡ, món canh)")
    pantry_df = st.session_state.pantry.dropna(subset=["Nguyên liệu", "Hạn dùng"])
    pantry = {}
    for _, r in pantry_df.iterrows():
        k = VI2KEY.get(r["Nguyên liệu"])
        d = r["Hạn dùng"]
        if k:
            pantry[k] = min(pantry.get(k, d), d)

    cA, cB = st.columns(2)
    if cA.button("🍽️ Gợi ý món", type="primary", disabled=not pantry):
        st.session_state.results = recommend(pantry, servings, topk)
    if not pantry:
        st.info("Hãy nhận diện hoặc thêm nguyên liệu ở tab đầu tiên.")

    if llm.available():
        if cB.button("✨ Sinh công thức bằng AI (Gemini)", disabled=not pantry):
            days = {k: (d - date.today()).days for k, d in pantry.items()}
            try:
                with st.spinner("AI đang nghĩ món..."):
                    st.session_state.ai = llm.generate_recipe(days, servings, pref)
            except Exception as e:
                st.error(f"Lỗi gọi LLM: {e}")
    else:
        cB.caption("Đặt biến môi trường `GEMINI_API_KEY` để bật gợi ý bằng LLM.")

    ai = st.session_state.get("ai")
    if ai:
        with st.expander(f"✨ AI gợi ý: {ai.get('name')} (~{ai.get('time', '?')} phút)", expanded=True):
            st.markdown("**Nguyên liệu:**\n" + "\n".join(f"- {x}" for x in ai.get("ingredients", [])))
            st.markdown("**Cách làm:**\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(ai.get("steps", []), 1)))
            if ai.get("tips"):
                st.info(ai["tips"])
            if st.button("⭐ Lưu món AI", key="fav_ai"):
                favorites.add({"name": ai["name"], "time": ai.get("time"), "servings": servings,
                               "scaled_text": ai.get("ingredients", []), "steps": ai.get("steps", [])})
                st.success("Đã lưu!")

    for rec in st.session_state.results or []:
        with st.expander(f"{rec['name']}  —  phù hợp {rec['score']*100:.0f}% · ⏱ {rec['time']} phút", expanded=False):
            st.progress(min(1.0, rec["coverage"]), text=f"Có {len(rec['have'])}/{len(rec['ingredients'])} nguyên liệu chính")
            if rec["urgent_used"]:
                st.success("♻️ Dùng nguyên liệu sắp hết hạn: " + ", ".join(vi_name(k) for k in rec["urgent_used"]))
            ing_lines = [f"- {'✅' if k in rec['have'] else '❌'} {vi_name(k)}: {a}"
                         f" ({INGREDIENTS[k][3]})" for k, a in rec["scaled"].items()]
            st.markdown(f"**Nguyên liệu cho {rec['servings']} người:**\n" + "\n".join(ing_lines))
            if rec["optional_have"]:
                st.markdown("Tùy chọn có sẵn: " + ", ".join(vi_name(k) for k in rec["optional_have"]))
            if rec["pantry"]:
                st.markdown("Gia vị cần: " + ", ".join(rec["pantry"]))
            if rec["missing"]:
                st.markdown("🛒 **Cần mua thêm:** " + ", ".join(vi_name(k) for k in rec["missing"]))
            st.markdown("**Cách làm:**\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(rec["steps"], 1)))
            if st.button("⭐ Lưu vào yêu thích", key=f"fav{rec['id']}"):
                favorites.add({"name": rec["name"], "time": rec["time"], "servings": rec["servings"],
                               "scaled_text": [f"{vi_name(k)}: {a}" for k, a in rec["scaled"].items()],
                               "steps": rec["steps"]})
                st.success("Đã lưu!")
    if st.session_state.results == []:
        st.warning("Chưa có công thức phù hợp — hãy thêm nguyên liệu.")

with tab3:
    favs = favorites.load()
    if not favs:
        st.info("Chưa có món yêu thích.")
    for f in favs:
        with st.expander(f"⭐ {f['name']} · {f.get('time', '?')} phút · {f.get('servings', '')} người"):
            st.markdown("**Nguyên liệu:**\n" + "\n".join(f"- {x}" for x in f["scaled_text"]))
            st.markdown("**Cách làm:**\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(f["steps"], 1)))
            if st.button("🗑️ Xóa", key="del" + f["name"]):
                favorites.remove(f["name"])
                st.rerun()
