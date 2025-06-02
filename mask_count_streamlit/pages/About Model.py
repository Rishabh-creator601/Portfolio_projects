import streamlit as st 

st.title("Download Models")



st.sidebar.write("Uplaod Images/Videos in Home PAGE ")

st.markdown("**The Model is trained for detecting Person with Mask or without Mask**")

st.download_button(
    label="Download YOLO Model (Mask)",
    data="./models/best.pt",
    file_name="model_mask.pt"
)


st.markdown("**The Model is general yolo Model** ")

st.download_button(
    label="Download YOLO Model",
    data="./models/yolo11n.pt",
    file_name="model.pt"
)