# RestEnforcer
web extension for screen time control

## 功能
对于自行指定的url进行以下操作：
1. 打开网页时询问要做什么&预期用时，输入后即可开始浏览，预期用时结束后必须关闭该页面10分钟后才能再次浏览。
   <img width="1358" height="826" alt="image" src="https://github.com/user-attachments/assets/07a54717-d627-4959-b6d6-f3045a769ea9" />
   为了保护视力，预期用时不可超过40分钟，即输入任何大于40的数字都会=40。（这个时间如果想调的话在background.js最上面几行就能改）
2. 定时屏蔽：可以设定每天几点到几点禁止浏览，则到时会统一用黑屏罩起来。若正处在屏蔽时段，则无法修改这个时间设置。

url和定时屏蔽时间的设置都是直接点开插件即可设置（正处在休息时间时不可修改）
<img width="447" height="783" alt="image" src="https://github.com/user-attachments/assets/16ae5028-048b-410e-b86f-1de8ab38e703" />


## 使用方法
浏览器右上角三个点 --> 扩展 --> 打开“开发人员模式” --> 加载解压缩的扩展 --> 选择RestEnforcer文件夹即可
<img width="459" height="93" alt="image" src="https://github.com/user-attachments/assets/93c9aef6-5b9e-4157-8d4e-6380eeedad15" />
<img width="609" height="123" alt="image" src="https://github.com/user-attachments/assets/71ee0315-c2d1-4f15-a259-0a99ba1b0bc4" />
