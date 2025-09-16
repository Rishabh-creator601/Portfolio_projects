import random , shutil ,os
### CODE FOR GENERARING N SAMPLE IMAGES 

images  =[]
path_ = None
for path,_,image in os.walk("./flower_data/valid/images"):
    images.append(image)
    path_ = path


if not os.path.exists("sample_images"):
    os.mkdir("sample_images")
    print("Creating folder ...")
    


for i in range(15):
    idx =  random.randint(0,len(images[0])-1)
    
    shutil.copy2(f"{path_}/{images[0][idx]}","sample_images")
    os.rename(f"sample_images/{images[0][idx]}",f"sample_images/flower_{i+1}.jpg")
    print(f"Image Sno :  {i} idx : {idx} Copied ...")
    
