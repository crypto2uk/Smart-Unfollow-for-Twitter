// Twitter滚动到底部工具 - 内容脚本

/**
 * 等待指定毫秒数
 * @param {number} ms 等待的毫秒数
 * @returns {Promise} 等待完成的Promise
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 滚动到页面的底部，通过多次尝试确保真正到达底部
 * @returns {Promise<boolean>} 操作成功完成返回true
 */
async function scrollToBottom() {
  console.log("开始执行滚动到页面底部操作...");
  
  let lastHeight = 0;
  let unchangedCount = 0;
  const maxUnchanged = 10; // 增加更多的尝试次数，确保真正到达底部
  
  // 首先滚动到当前底部
  window.scrollTo(0, document.body.scrollHeight);
  await delay(1500);
  
  lastHeight = document.body.scrollHeight;
  console.log(`初始高度: ${lastHeight}px`);
  
  // 循环滚动直到真正到达底部
  while (unchangedCount < maxUnchanged) {
    // 滚动到文档底部
    window.scrollTo(0, document.body.scrollHeight);
    await delay(1500); // 等待加载
    
    // 检查高度是否变化
    const newHeight = document.body.scrollHeight;
    console.log(`当前高度: ${newHeight}px, 上次高度: ${lastHeight}px, 未变化计数: ${unchangedCount}`);
    
    if (newHeight === lastHeight) {
      unchangedCount++;
      console.log(`页面高度未变化 (${unchangedCount}/${maxUnchanged})`);
    } else {
      unchangedCount = 0; // 高度变化，重置计数器
      lastHeight = newHeight;
      console.log(`页面高度变化，重置计数`);
    }
  }
  
  console.log(`已到达页面底部，最终高度: ${lastHeight}px`);
  return true;
}

// 监听来自扩展的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrollToBottom') {
    console.log('收到滚动到底部的消息');
    
    scrollToBottom()
      .then(() => {
        sendResponse({ status: "success", message: "滚动到底部操作完成" });
      })
      .catch(error => {
        console.error('滚动到底部时出错:', error);
        sendResponse({ status: "error", message: error.toString() });
      });
    
    return true; // 表示我们将异步发送响应
  }
});

console.log('Twitter滚动到底部工具 - 内容脚本已加载'); 