import streamlit as st 
from  PIL import Image
import io,cv2,warnings,os
import numpy as np
from utils import *
from ultralytics import YOLO
import pandas as pd





st.sidebar.title("FLower  Detection")
warnings.filterwarnings("ignore")


sample_folder = "sample_images"
sample_list = ["None"] + os.listdir(sample_folder)
sample_choice = st.sidebar.selectbox("Choose Sample Image:", sample_list)


holder  = st.empty()

if sample_choice != "None":
    image_bytes = open(os.path.join(sample_folder, sample_choice), "rb")
else:
    image_bytes = holder.file_uploader("Choose a PNG file", type=["png","jpg"])




    
if image_bytes is not None:
    image =  np.array(Image.open(io.BytesIO(image_bytes.read())))
    
    holder.image(image, caption="Uploaded Image", use_container_width=True)
    
    if st.button("Detect Image =>"):
        image_resized = cv2.resize(image,(640,640))
        image_resized = cv2.cvtColor(image_resized, cv2.COLOR_BGR2RGB)
        
        
        with st.spinner("Detecting..."):
            
            

            detected_image, classes, length_objs = detect_flower_image(image_resized)
            
            holder.empty()
            
            st.image(detected_image, caption="Detected Image", use_container_width=True)
            
                    
            if length_objs > 0:
                st.success(f"Total objects detected: {length_objs}")
                st.markdown("### 🍱 Detected Flower Items")
                # Convert classes dict to table format
                table_data = []
                

                for key, conf in classes.items():
                    flower_name = key.split('_')[0].capitalize()
                    table_data.append({"Flower Found": key, "Confidence (%)": conf})

                df = pd.DataFrame(table_data)

            
                st.table(df)
                
            else:
                st.info("No Flower  items detected.")

            
            print(f"Total objects detected: {length_objs}")
            print("Classes detected:", classes)
            
        