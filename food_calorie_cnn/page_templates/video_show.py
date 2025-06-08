import streamlit as st 
from track_ import detect_food_video
import tempfile , cv2
import pandas as pd 



def show():
    
    st.title("YOLOV11 Junk Food Calorie detection (By Video)")
    st.info("NOTE : Video Might be Slow due to running in browser else it is working fine")
    
    holder  = st.empty()
    table_holder =  st.empty()
    video_bytes = holder.file_uploader("Choose a Video file", type=["mp4", "mov", "avi", "mkv"])
    
    if video_bytes  is not None:
        holder.empty()

        tfile =  tempfile.NamedTemporaryFile(delete=False)
        tfile.write(video_bytes.read())
        
        frame_count = 0
        skip_every=5
        
        
        cap =  cv2.VideoCapture(tfile.name)
        empty_frame= st.empty()
        
        while cap.isOpened() :
            ret,frame = cap.read()
            
            
            frame_count += 1
            
            (frame,df,length_objs) =  detect_food_video(frame=frame,to_rgb=True)
            
            if frame_count % skip_every == 0:
                empty_frame.image(frame,channels="RGB")
                table_holder.dataframe(df)
                
            if not ret :
                break                
            
            
        cap.release()
        
    