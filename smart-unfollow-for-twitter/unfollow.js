// unfollow.js
// Core script for unfollowing all Twitter/X accounts

// 全局变量用于高亮
// 通过window对象避免重复声明变量
if (typeof window.tfHighlightUsernames === 'undefined') {
  window.tfHighlightUsernames = new Set();
}
if (typeof window.tfIntersectionObserver === 'undefined') {
  window.tfIntersectionObserver = null;
}
if (typeof window.tfMutationObserver === 'undefined') {
  window.tfMutationObserver = null;
}

// 常量定义不会引起重复声明错误
const highlightColor = 'rgba(255, 255, 0, 0.3)';
const accountCellSelector = '[data-testid="cellInnerDiv"], [data-testid="UserCell"]';
const timelineSelector = '[data-testid="primaryColumn"]'; // 观察这个区域的变化

// 在unfollow.js中添加全局错误处理器来捕获扩展上下文失效错误
window.addEventListener('error', (event) => {
  if (event.error && event.error.message && 
      event.error.message.includes('Extension context invalidated')) {
    console.log('扩展上下文已失效，这是正常现象，不影响功能');
    event.preventDefault(); // 阻止错误显示在控制台
  }
});

// 添加获取关注列表的功能
async function getFollowingList(limit = 100, keepList = new Set()) {
  let followingList = [];
  let shouldStop = false;
  let nonKeptCount = 0; // 计数器：未标记为保留的账号数量
  const targetNonKeptCount = limit; // 目标未保留账号数量
  
  console.log(`搜索目标: ${targetNonKeptCount} 个未标记保留的账号, 已有 ${keepList.size} 个保留账号`);
  
  // Listen for stop messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'stop') {
      shouldStop = true;
      sendResponse({status: 'stopped'});
      return true;
    }
  });

  // Wait for an element to appear with timeout
  const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkElement = () => {
        const element = document.querySelector(selector);
        if (element) resolve(element);
        else if (Date.now() - startTime > timeout) reject(new Error(`Timeout waiting for ${selector}`));
        else if (shouldStop) reject(new Error('Process stopped by user'));
        else setTimeout(checkElement, 100);
      };
      checkElement();
    });
  };

  // Delay function with random jitter
  const delay = (ms) => new Promise(resolve => {
    const timeout = setTimeout(resolve, ms + (Math.random() * 300));
    if (shouldStop) clearTimeout(timeout);
  });

  // 定义一个独立的滚动到页面底部的函数
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
    while (unchangedCount < maxUnchanged && !shouldStop) {
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

  // 修改原来的滚动函数以使用新的滚动到底部函数
  const scrollDownToLoadMore = async () => {
    // 计算此时未标记为保留的账号数量
    nonKeptCount = followingList.filter(account => !keepList.has(account.username)).length;
    const keptCount = followingList.filter(account => keepList.has(account.username)).length;
    console.log(`向下滚动前: 共${followingList.length}个账号, 其中${nonKeptCount}个未标记保留, ${keptCount}个已标记保留`);
    
    // 先确保滚动到页面真正底部，加载所有内容
    await scrollToBottom();
    
    if (shouldStop) return;
    
    // 提取所有可见账号
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    let newAccountsFound = 0;
    let newNonKeptFound = 0;
    
    for (let i = 0; i < cells.length; i++) {
      if (shouldStop) break;
      
      const accountInfo = extractAccountInfo(cells[i], keepList);
      if (accountInfo && !followingList.some(item => item.username === accountInfo.username)) {
        followingList.push(accountInfo);
        newAccountsFound++;
        
        // 更新未标记为保留的账号计数
        if (!keepList.has(accountInfo.username)) {
          nonKeptCount++;
          newNonKeptFound++;
        }
        
        // 如果找到足够的未标记保留的账号，可以停止
        if (nonKeptCount >= targetNonKeptCount) {
          console.log(`已找到足够的未标记保留账号: ${nonKeptCount}/${targetNonKeptCount}`);
          break;
        }
      }
    }
    
    console.log(`本次滚动找到 ${newAccountsFound} 个新账号 (${newNonKeptFound} 个未标记保留), 当前总计: ${nonKeptCount}/${targetNonKeptCount} 个未标记保留`);
    
    // 更新提取进度
    try {
      chrome.runtime.sendMessage({
        type: 'previewProgress',
        found: nonKeptCount,
        total: targetNonKeptCount
      });
    } catch (error) {
      console.log('无法发送进度更新 - 弹出窗口可能已关闭');
    }
    
    const finalKeptCount = followingList.filter(account => keepList.has(account.username)).length;
    console.log(`向下滚动后: 共${followingList.length}个账号, 其中${nonKeptCount}个未标记保留, ${finalKeptCount}个已标记保留`);
  };
  
  // 向上滚动查找账号
  const scrollUpToLoadMore = async () => {
    let lastHeight = document.body.scrollHeight;
    let unchangedCount = 0;
    const maxUnchanged = 3;
    
    // 更新账号计数
    nonKeptCount = followingList.filter(account => !keepList.has(account.username)).length;
    const keptCount = followingList.filter(account => keepList.has(account.username)).length;
    console.log(`向上滚动前: 共${followingList.length}个账号, 其中${nonKeptCount}个未标记保留, ${keptCount}个已标记保留`);
    
    // 如果已经找到足够多的未标记保留账号，可以跳过
    if (nonKeptCount >= targetNonKeptCount) {
      console.log(`已经找到足够的未标记保留账号(${nonKeptCount}/${targetNonKeptCount})，不需要向上滚动`);
      return;
    }
    
    // 记录初始滚动位置
    let previousScrollY = window.scrollY;
    let scrollAttempts = 0;
    let reachedTop = false;
    
    // 用于追踪页面内容变化
    let previousVisibleAccounts = new Set();
    let sameContentCount = 0;
    const maxSameContent = 10; // 如果连续10次滚动看到相同的账号，则认为已达极限
    
    console.log('开始从底部向上滚动搜索账号...');
    
    // 无限滚动，直到找到足够的账号、到达页面顶部、用户停止，或页面内容不再变化
    while (nonKeptCount < targetNonKeptCount && !shouldStop && !reachedTop && sameContentCount < maxSameContent) {
      // 向上滚动一屏高度
      window.scrollBy(0, -window.innerHeight * 0.9);
      await delay(1500);
      
      if (shouldStop) break;
      
      scrollAttempts++;
      
      // 检查滚动位置是否有实际变化
      const currentScrollY = window.scrollY;
      console.log(`滚动位置: ${currentScrollY}px, 上次位置: ${previousScrollY}px, 滚动次数: ${scrollAttempts}`);
      
      // 如果滚动位置接近零，已经到达顶部
      if (currentScrollY < 100) {
        console.log('已接近页面顶部 (scrollY < 100px)');
        reachedTop = true;
        break;
      } else if (Math.abs(currentScrollY - previousScrollY) < 50) {
        console.log('滚动位置变化很小，可能接近页面顶部');
        unchangedCount++;
        
        if (unchangedCount >= 2) {
          console.log('连续多次滚动无明显变化，确认已达到页面顶部');
          reachedTop = true;
          break;
        }
      } else {
        unchangedCount = 0;
        previousScrollY = currentScrollY;
      }
      
      // 提取当前可见的账号信息
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      let newAccountsFound = 0;
      let newNonKeptFound = 0;
      
      // 收集当前可见账号的用户名
      const currentVisibleAccounts = new Set();
      
      for (const cell of cells) {
        const accountInfo = extractAccountInfo(cell, keepList);
        if (!accountInfo) continue;
        
        // 将用户名添加到当前可见账号集合
        currentVisibleAccounts.add(accountInfo.username);
        
        // 如果是新账号，添加到关注列表
        if (!followingList.some(a => a.username === accountInfo.username)) {
          followingList.push(accountInfo);
          newAccountsFound++;
          
          // 更新未标记为保留的账号计数
          if (!keepList.has(accountInfo.username)) {
            nonKeptCount++;
            newNonKeptFound++;
          }
          
          // 周期性发送进度更新 (每10个账号更新一次)
          if (nonKeptCount % 10 === 0) {
            sendPreviewProgress();
          }
          
          // 如果找到足够的未标记保留的账号，可以停止
          if (nonKeptCount >= targetNonKeptCount) {
            console.log(`已找到足够的未标记保留账号: ${nonKeptCount}/${targetNonKeptCount}`);
            sendPreviewProgress(); // 立即发送一次进度更新
            break;
          }
        }
      }
      
      console.log(`本次滚动找到 ${newAccountsFound} 个新账号 (${newNonKeptFound} 个未标记保留), 当前总计: ${nonKeptCount}/${targetNonKeptCount} 个未标记保留`);
      
      // 检查页面内容是否变化
      if (currentVisibleAccounts.size > 0) {
        // 比较当前可见账号和之前可见账号
        let sameContent = true;
        
        // 检查数量是否相同
        if (currentVisibleAccounts.size !== previousVisibleAccounts.size) {
          sameContent = false;
        } else {
          // 检查内容是否相同
          for (const username of currentVisibleAccounts) {
            if (!previousVisibleAccounts.has(username)) {
              sameContent = false;
              break;
            }
          }
        }
        
        if (sameContent && currentVisibleAccounts.size > 0) {
          sameContentCount++;
          console.log(`页面内容未变化 (${sameContentCount}/${maxSameContent})`);
        } else {
          sameContentCount = 0;
          // 更新之前可见账号集合
          previousVisibleAccounts = new Set(currentVisibleAccounts);
          console.log(`页面内容已更新，发现 ${currentVisibleAccounts.size} 个账号`);
        }
      }
      
      // 更新提取进度
      try {
        chrome.runtime.sendMessage({
          type: 'previewProgress',
          found: nonKeptCount,
          total: targetNonKeptCount
        });
      } catch (error) {
        console.log('无法发送进度更新 - 弹出窗口可能已关闭');
      }
    }
    
    // 记录最终状态
    if (reachedTop) {
      console.log('已到达页面顶部，完成向上滚动搜索');
    } else if (nonKeptCount >= targetNonKeptCount) {
      console.log('已找到足够数量的待取消关注账号，停止向上滚动');
    } else if (sameContentCount >= maxSameContent) {
      console.log(`连续 ${maxSameContent} 次滚动页面内容未变化，可能已达到加载极限，停止向上滚动`);
    }
    
    const finalKeptCount = followingList.filter(account => keepList.has(account.username)).length;
    console.log(`向上滚动后: 共${followingList.length}个账号, 其中${nonKeptCount}个未标记保留, ${finalKeptCount}个已标记保留`);
  };
  
  // 添加发送预览进度的辅助函数
  const sendPreviewProgress = () => {
    try {
      chrome.runtime.sendMessage({
        type: 'previewProgress',
        found: nonKeptCount,
        total: targetNonKeptCount
      });
    } catch (error) {
      console.log('无法发送进度更新 - 弹出窗口可能已关闭');
    }
  };
  
  // 修改提取账号信息的方法，增加排除"已关注你"用户的功能，并高亮待取消关注的用户块
  const extractAccountInfo = (cell, keepList) => {
    try {
      // 首先检查是否为"已关注你"的用户，如果是则跳过
      const followsYouIndicator = cell.querySelector('[data-testid="userFollowIndicator"]');
      if (followsYouIndicator) {
        const indicatorText = followsYouIndicator.textContent.trim();
        if (indicatorText.includes('关注了你') || indicatorText.includes('Follows you')) {
          // console.log('跳过已关注你的用户');
          // 重置背景色以防万一
          cell.style.backgroundColor = ''; 
          return null;
        }
      }

      // 按钮类型1: 带有data-testid属性且包含unfollow的按钮
      let followButton = cell.querySelector('button[data-testid*="unfollow"]');
      
      // 按钮类型2: 文本内容包含"正在关注"的按钮
      if (!followButton) {
        const allButtons = cell.querySelectorAll('button');
        for (const btn of allButtons) {
          if (btn.textContent.includes('正在关注') || btn.textContent.includes('Following')) {
            followButton = btn;
            break;
          }
        }
      }
      
      // 如果没找到关注按钮，这可能不是我们要找的单元格
      if (!followButton) {
        return null;
      }
      
      let displayName = '';
      let username = '';
      
      // 尝试从aria-label提取用户名
      const ariaLabel = followButton.getAttribute('aria-label');
      if (ariaLabel) {
        // 格式通常是"正在关注 @username"或"Following @username"
        const match = ariaLabel.match(/@([a-zA-Z0-9_]+)/);
        if (match && match[1]) {
          username = match[1];
        }
      }
      
      // 如果从aria-label找不到，尝试查找所有可能包含@的span
      if (!username) {
        const allSpans = cell.querySelectorAll('span');
        for (const span of allSpans) {
          const text = span.textContent.trim();
          if (text.startsWith('@')) {
            username = text.substring(1); // 去掉@
            break;
          }
        }
      }
      
      // 寻找显示名称 - 遍历所有文本元素找到最可能的显示名称
      // 显示名称通常是单元格中的粗体文本
      const allTextElements = cell.querySelectorAll('div[dir="ltr"], span');
      let possibleNames = [];
      
      for (const elem of allTextElements) {
        const text = elem.textContent.trim();
        // 排除用户名和按钮文本
        if (text && 
            !text.startsWith('@') && 
            !text.includes('正在关注') &&
            !text.includes('Following') &&
            !text.includes('关注了你') &&
            !text.includes('Follows you') &&
            text.length < 50) { // 显示名称通常不会太长
            
          // 查看样式，粗体元素更可能是名称
          const style = window.getComputedStyle(elem);
          const fontWeight = parseInt(style.fontWeight, 10) || 400;
          
          possibleNames.push({
            text,
            weight: fontWeight,
            // 如果元素在页面顶部，更可能是名称
            position: elem.getBoundingClientRect().top
          });
        }
      }
      
      // 按权重和位置排序
      possibleNames.sort((a, b) => {
        // 权重差异显著时优先考虑权重
        if (Math.abs(b.weight - a.weight) > 100) {
          return b.weight - a.weight;
        }
        // 否则考虑位置
        return a.position - b.position;
      });
      
      if (possibleNames.length > 0) {
        displayName = possibleNames[0].text;
      }
      
      // 如果仍然没有找到，尝试使用href属性
      if (!displayName || !username) {
        const links = cell.querySelectorAll('a[href*="/"]');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/') && !href.includes('/search') && !href.includes('/hashtag')) {
            const potentialUsername = href.split('/').filter(Boolean)[0];
            
            // 用户名通常只包含字母、数字和下划线
            if (potentialUsername && /^[a-zA-Z0-9_]+$/.test(potentialUsername)) {
              if (!username) {
                username = potentialUsername;
              }
              
              // 如果找不到显示名称，尝试从链接文本中获取
              if (!displayName) {
                const linkText = link.textContent.trim();
                if (linkText && !linkText.startsWith('@')) {
                  displayName = linkText;
                }
              }
            }
          }
        }
      }
      
      // 调试信息
      // console.log('提取账号:', { displayName, username, followButtonText: followButton.textContent });
      
      // 确保有有效数据
      if (!username) {
        // 重置背景色
        cell.style.backgroundColor = '';
        return null;
      }
      
      // 如果仍然没有显示名称，使用用户名作为备用
      if (!displayName) {
        displayName = username;
      }
      
      // **新增：检查是否在保留列表，如果不在则高亮**
      if (!keepList.has(username)) {
        // console.log(`Highlighting @${username} for unfollow.`);
        cell.style.backgroundColor = 'rgba(255, 255, 0, 0.3)'; // 使用带透明度的黄色
      } else {
        // 如果在保留列表，确保没有背景色
        cell.style.backgroundColor = ''; 
      }
      
      return {
        displayName,
        username
      };
    } catch (error) {
      console.error('提取账号信息出错:', error);
      return null;
    }
  };
  
  // 查找完整的Timeline以包含所有保留账号
  async function findAllKeptAccounts() {
    console.log('正在尝试查找所有已标记为保留的账号...');
    if (keepList.size === 0) {
      console.log('没有标记为保留的账号，跳过此步骤');
      return;
    }
    
    // 创建保留账号的集合，用于追踪我们已经找到了哪些保留账号
    const foundKeptAccounts = new Set();
    followingList.forEach(account => {
      if (keepList.has(account.username)) {
        foundKeptAccounts.add(account.username);
      }
    });
    
    // 计算有多少保留账号尚未找到
    const missingKeptAccounts = new Set([...keepList].filter(username => !foundKeptAccounts.has(username)));
    console.log(`当前已找到 ${foundKeptAccounts.size}/${keepList.size} 个保留账号，还有 ${missingKeptAccounts.size} 个未找到`);
    
    if (missingKeptAccounts.size === 0) {
      console.log('所有保留账号已找到，无需额外搜索');
      return;
    }
    
    // 记录当前滚动位置，以便稍后保持位置不变
    const currentScrollPosition = window.scrollY;
    console.log(`保存当前滚动位置: ${currentScrollPosition}px`);
    
    // 在当前可视区域搜索保留账号
    console.log('在当前位置搜索保留账号...');
    
    // 向下滚动查找所有账号
    let lastHeight = 0;
    let unchangedCount = 0;
    const maxUnchanged = 3;
    let scrollCount = 0;
    const maxScrolls = 5; // 减少最大滚动次数，避免滚动太远
    
    while (missingKeptAccounts.size > 0 && unchangedCount < maxUnchanged && scrollCount < maxScrolls && !shouldStop) {
      scrollCount++;
      console.log(`轻微滚动查找保留账号 (${scrollCount}/${maxScrolls})...`);
      
      // 仅在当前视图附近小范围滚动
      window.scrollBy(0, window.innerHeight * 0.5);
      await delay(1500);
      
      if (shouldStop) break;
      
      const newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) {
        unchangedCount++;
      } else {
        unchangedCount = 0;
        lastHeight = newHeight;
      }
      
      // 提取当前可见的账号
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      let newKeptFound = 0;
      
      for (const cell of cells) {
        const accountInfo = extractAccountInfo(cell, keepList);
        if (!accountInfo) continue;
        
        // 检查是否是我们正在寻找的保留账号
        if (keepList.has(accountInfo.username) && !foundKeptAccounts.has(accountInfo.username)) {
          // 添加到账号列表
          if (!followingList.some(a => a.username === accountInfo.username)) {
            followingList.push(accountInfo);
            foundKeptAccounts.add(accountInfo.username);
            missingKeptAccounts.delete(accountInfo.username);
            newKeptFound++;
            
            console.log(`找到保留账号: ${accountInfo.displayName} (@${accountInfo.username})`);
          }
        }
      }
      
      console.log(`这一轮找到 ${newKeptFound} 个新的保留账号，还有 ${missingKeptAccounts.size} 个未找到`);
      
      // 如果找到了所有保留账号或者到达页面底部，就停止
      if (missingKeptAccounts.size === 0 || (cells.length < 10 && unchangedCount >= 2)) {
        break;
      }
    }
    
    console.log(`保留账号搜索完成，找到 ${foundKeptAccounts.size}/${keepList.size} 个，仍有 ${missingKeptAccounts.size} 个未找到`);
    
    // 恢复到原始滚动位置
    console.log(`恢复滚动位置到: ${currentScrollPosition}px`);
    window.scrollTo(0, currentScrollPosition);
    await delay(1000);
  }
  
  try {
    // 检查是否在关注页面
    if (!window.location.pathname.endsWith('/following')) {
      const username = window.location.pathname.split('/').filter(Boolean)[0];
      if (!username) {
        throw new Error('无法从URL确定用户名');
      }
      // 导航到关注页面
      window.location.href = `${window.location.origin}/${username}/following`;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log('开始获取关注列表...');
    console.log(`已有 ${keepList.size} 个保留账号列表`);
    
    // 等待用户单元格加载
    await waitForElement('[data-testid="cellInnerDiv"]', 10000);
    
    // 先滚动到页面底部
    console.log('首先滚动到页面底部...');
    await scrollToBottom();
    
    if (shouldStop) {
      console.log('用户停止了操作');
      return [];
    }
    
    console.log('已滚动到页面底部，开始从下往上提取账号');
    
    // 初始提取当前可见的账号（从底部开始）
    const initialCells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    console.log(`找到 ${initialCells.length} 个初始单元格`);
    
    // 遍历所有单元格
    for (const cell of initialCells) {
      if (shouldStop) break;
      const accountInfo = extractAccountInfo(cell, keepList);
      if (accountInfo) {
        if (!followingList.some(item => item.username === accountInfo.username)) {
          followingList.push(accountInfo);
          
          // 更新未标记为保留的账号计数
          if (!keepList.has(accountInfo.username)) {
            nonKeptCount++;
          }
          
          // 周期性发送进度更新 (每10个账号更新一次)
          if (nonKeptCount % 10 === 0) {
            sendPreviewProgress();
          }
          
          // 如果初始扫描已经找到足够的未标记保留账号，直接停止
          if (nonKeptCount >= targetNonKeptCount) {
            console.log(`初始扫描已找到足够的未标记保留账号: ${nonKeptCount}/${targetNonKeptCount}`);
            sendPreviewProgress(); // 立即发送一次进度更新
            break;
          }
        }
      }
    }
    
    console.log(`初始提取完成，找到 ${followingList.length} 个账号，${nonKeptCount} 个未标记保留`);
    sendPreviewProgress(); // 发送进度更新
    
    // 如果需要，继续从底部向上滚动加载更多
    if (nonKeptCount < targetNonKeptCount && !shouldStop) {
      // 从底部向上滚动查找
      await scrollUpToLoadMore();
      
      // 检查scrollUpToLoadMore是否因到达顶部而停止
      const reachedTop = window.scrollY < 200;
      
      // 如果还没找到足够的未标记保留账号，且没有到达顶部，才尝试向下滚动
      if (nonKeptCount < targetNonKeptCount && !shouldStop && !reachedTop) {
        console.log("向上滚动未找到足够账号，且未到达顶部，尝试向下滚动...");
        await scrollDownToLoadMore();
      } else if (reachedTop) {
        console.log("已经到达页面顶部，不再执行向下滚动搜索");
      }
    }
    
    // 保存当前滚动位置，用于在搜索保留账号后恢复
    const currentPosition = window.scrollY;
    console.log(`保存当前滚动位置: ${currentPosition}px，用于在搜索保留账号后恢复`);
    
    // 仅当找到足够的未标记保留账号，或者已经达到页面顶部时，才搜索保留账号
    // 这确保了我们不会在向上滚动搜索未完成时中断搜索过程
    if ((nonKeptCount >= targetNonKeptCount) || (window.scrollY < 200)) {
      // 如果已经找到足够的未标记保留账号，简化保留账号搜索
      if (nonKeptCount >= targetNonKeptCount) {
        console.log(`已找到足够的未标记保留账号(${nonKeptCount}/${targetNonKeptCount})，将简化保留账号搜索`);
      } else {
        console.log(`虽然只找到 ${nonKeptCount}/${targetNonKeptCount} 个账号，但已达页面顶部，继续搜索保留账号`);
      }
      
      // 搜索保留账号
      await findAllKeptAccounts();
      
      // 恢复滚动位置
      console.log(`恢复到保存的滚动位置: ${currentPosition}px`);
      window.scrollTo(0, currentPosition);
      await delay(1000);
    } else {
      console.log(`仅找到 ${nonKeptCount}/${targetNonKeptCount} 个账号，且尚未到达页面顶部，跳过保留账号搜索步骤`);
    }
    
    const finalKeptCount = followingList.filter(account => keepList.has(account.username)).length;
    nonKeptCount = followingList.filter(account => !keepList.has(account.username)).length;
    console.log(`完成加载，共找到 ${followingList.length} 个账号，其中 ${nonKeptCount} 个未标记保留，${finalKeptCount} 个已标记保留`);
    
    // 裁剪未标记保留的账号至100个
    if (nonKeptCount > targetNonKeptCount) {
      console.log(`找到了 ${nonKeptCount} 个未标记保留账号，超过了目标 ${targetNonKeptCount}，将裁剪列表`);
      
      // 先保留所有已标记为保留的账号
      const keptAccounts = followingList.filter(account => keepList.has(account.username));
      
      // 再获取前100个未标记为保留的账号
      const nonKeptAccounts = followingList.filter(account => !keepList.has(account.username))
                                        .slice(0, targetNonKeptCount);
      
      // 合并两个列表
      followingList = [...nonKeptAccounts, ...keptAccounts];
      
      nonKeptCount = nonKeptAccounts.length;
      console.log(`裁剪后: 共${followingList.length}个账号，其中${nonKeptCount}个未标记保留，${keptAccounts.length}个已标记保留`);
    }
    
    // 去重
    const uniqueAccounts = [];
    const seen = new Set();
    for (const account of followingList) {
      if (!seen.has(account.username)) {
        seen.add(account.username);
        uniqueAccounts.push(account);
      }
    }
    
    console.log(`去重后剩余 ${uniqueAccounts.length} 个账号`);
    
    // 排序：将未标记保留的账号排在前面
    uniqueAccounts.sort((a, b) => {
      const aIsKept = keepList.has(a.username);
      const bIsKept = keepList.has(b.username);
      if (aIsKept && !bIsKept) return 1;
      if (!aIsKept && bIsKept) return -1;
      return 0;
    });
    
    // 返回列表给popup
    return uniqueAccounts;
  } catch (error) {
    console.error('获取关注列表出错:', error);
    throw error;
  }
}

// 添加新函数，用于取消关注选择的账号
async function unfollowSelectedAccounts(accountsList) {
  console.log(`unfollowSelectedAccounts 被调用，收到 ${accountsList?.length || 0} 个账号`);
  
  let totalFound = accountsList?.length || 0;
  let unfollowedCount = 0;
  let shouldStop = false;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  let rateLimitPause = false;
  let unfollowedAccounts = []; // 存储已经取消关注的账号
  let remainingAccounts = accountsList ? [...accountsList] : []; // 复制一份账号列表，用于跟踪剩余的账号

  console.log(`初始化取消关注任务，${remainingAccounts.length} 个待处理账号`);

  // 先检查是否已经有保存的未完成取消关注任务
  const loadSavedTask = async () => {
    try {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(['unfollowTask', 'unfollowList', 'progress'], (result) => {
            try {
              if (chrome.runtime.lastError) {
                console.log('加载保存的任务状态时出错:', chrome.runtime.lastError);
                resolve(false);
                return;
              }
              
              // 检查是否有保存的任务状态
              if (result.unfollowTask && 
                  result.unfollowTask.remainingAccounts && 
                  result.unfollowTask.remainingAccounts.length > 0) {
                console.log('恢复未完成的取消关注任务');
                remainingAccounts = result.unfollowTask.remainingAccounts;
                unfollowedAccounts = result.unfollowTask.unfollowedAccounts || [];
                unfollowedCount = unfollowedAccounts.length;
                totalFound = unfollowedCount + remainingAccounts.length;
                
                console.log(`已恢复任务: 总计 ${totalFound} 个账号, 已处理 ${unfollowedCount} 个, 剩余 ${remainingAccounts.length} 个`);
                resolve(true);
                return;
              } 
              
              // 如果没有保存的任务状态，但有进度信息，可能是中断的任务
              if (result.progress && result.progress.totalFound > 0 && result.unfollowList && result.unfollowList.length > 0) {
                console.log('检测到中断的任务，尝试恢复...');
                
                const completedCount = result.progress.unfollowed || 0;
                console.log(`进度信息: 共 ${result.progress.totalFound} 个账号, 已处理 ${completedCount} 个`);
                
                // 使用传入的账号列表
                if (accountsList && accountsList.length > 0) {
                  remainingAccounts = [...accountsList];
                  unfollowedAccounts = [];
                  unfollowedCount = 0;
                  totalFound = remainingAccounts.length;
                  console.log(`使用新提供的账号列表: ${totalFound} 个账号`);
                  resolve(false);
                  return;
                }
                
                // 没有传入账号列表，尝试从storage恢复
                remainingAccounts = [...result.unfollowList];
                unfollowedAccounts = [];
                unfollowedCount = completedCount;
                totalFound = remainingAccounts.length + unfollowedCount;
                
                console.log(`从中断状态恢复: 共 ${totalFound} 个账号, 已处理 ${unfollowedCount} 个, 剩余 ${remainingAccounts.length} 个`);
                resolve(true);
                return;
              }
              
              // 如果没有状态但有账号列表，使用传入的账号列表
              if (!result.unfollowTask && accountsList && accountsList.length > 0) {
                console.log(`从传入的账号列表开始新任务: ${accountsList.length} 个账号`);
                remainingAccounts = [...accountsList];
                unfollowedAccounts = [];
                unfollowedCount = 0;
                totalFound = remainingAccounts.length;
                resolve(false);
                return;
              }
              
              // 最后尝试从storage直接读取账号列表
              if (!accountsList || accountsList.length === 0) {
                chrome.storage.local.get(['unfollowList'], (listResult) => {
                  if (listResult.unfollowList && listResult.unfollowList.length > 0) {
                    console.log(`从storage中读取到 ${listResult.unfollowList.length} 个账号`);
                    remainingAccounts = [...listResult.unfollowList];
                    unfollowedAccounts = [];
                    unfollowedCount = 0;
                    totalFound = remainingAccounts.length;
                  }
                  resolve(false);
                });
              } else {
                resolve(false);
              }
            } catch (innerError) {
              console.log('处理加载结果时出错:', innerError);
              resolve(false);
            }
          });
        } catch (storageError) {
          console.log('执行存储操作时出错:', storageError);
          resolve(false);
        }
      });
    } catch (outerError) {
      console.log('加载任务状态函数执行出错:', outerError);
      return false;
    }
  };

  // 保存当前任务状态
  const saveTaskState = async () => {
    try {
      // 创建任务对象前进行有效性检查
      if (!Array.isArray(remainingAccounts)) {
        console.error('保存任务状态时发现 remainingAccounts 不是数组');
        remainingAccounts = [];
      }
      
      if (!Array.isArray(unfollowedAccounts)) {
        console.error('保存任务状态时发现 unfollowedAccounts 不是数组');
        unfollowedAccounts = [];
      }
      
      const task = {
        remainingAccounts: remainingAccounts,
        unfollowedAccounts: unfollowedAccounts,
        lastUpdated: Date.now(),
        // 增加更多状态信息，方便恢复时分析
        totalFound: totalFound,
        unfollowedCount: unfollowedCount
      };
      
      // 先更新内部计数，保证一致性
      unfollowedCount = unfollowedAccounts.length;
      totalFound = unfollowedCount + remainingAccounts.length;
      
      // 使用可靠的Promise包装
      return new Promise((resolve, reject) => {
        try {
          // 同时更新多个相关状态
          chrome.storage.local.set({ 
            unfollowTask: task,
            // 同时更新进度信息
            progress: {
              totalFound: totalFound,
              unfollowed: unfollowedCount,
              status: `进行中：已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个`,
              lastUpdateTime: Date.now()
            },
            // 保持isRunning标记
            isRunning: true
          }, () => {
            if (chrome.runtime.lastError) {
              const errorMsg = '保存任务状态时出错:' + chrome.runtime.lastError.message;
              console.log(errorMsg);
              reject(new Error(errorMsg));
            } else {
              console.log(`任务状态已保存: 剩余 ${remainingAccounts.length} 个账号, 已完成 ${unfollowedCount} 个账号`);
              resolve();
            }
          });
        } catch (error) {
          console.log('执行存储操作时出错:', error);
          reject(error);
        }
      }).catch(error => {
        // 即使Promise被拒绝也不中断执行流程
        console.log('保存状态时发生错误，但任务将继续:', error);
        // 返回已解决的Promise以避免中断调用链
        return Promise.resolve();
      });
    } catch (error) {
      console.log('准备任务状态数据时出错:', error);
      // 返回已解决的Promise以避免中断调用链
      return Promise.resolve();
    }
  };

  // 移除账号并添加到已取消关注列表
  const removeAccountAndSave = async (account) => {
    // 为当前账号创建一个日志记录器
    const logger = createDebugLogger(account.username);
    
    try {
      // 从待取消关注列表中移除
      if (!Array.isArray(remainingAccounts)) {
        logger('警告: remainingAccounts 不是数组，正在尝试修复');
        remainingAccounts = [];
      }
      
      remainingAccounts = remainingAccounts.filter(a => a.username !== account.username);
      
      // 添加到已取消关注列表
      if (!Array.isArray(unfollowedAccounts)) {
        logger('警告: unfollowedAccounts 不是数组，正在尝试修复');
        unfollowedAccounts = [];
      }
      
      unfollowedAccounts.push({
        ...account,
        unfollowedAt: Date.now()
      });
      
      // 更新存储
      try {
        await saveTaskState();
      } catch (error) {
        logger(`保存任务状态时出错，继续执行: ${error.message}`);
      }
      
      // 更新已保存的预览账号列表，移除已取消关注的账号
      try {
        chrome.storage.local.get(['previewAccounts'], (result) => {
          if (chrome.runtime.lastError) {
            logger('获取预览账号列表时出错: ' + chrome.runtime.lastError.message);
            return;
          }
          
          if (result.previewAccounts && Array.isArray(result.previewAccounts)) {
            const updatedPreviewAccounts = result.previewAccounts.filter(
              a => a.username !== account.username || account.isKept
            );
            
            chrome.storage.local.set({ previewAccounts: updatedPreviewAccounts }, () => {
              if (chrome.runtime.lastError) {
                logger('保存更新后的预览账号列表时出错: ' + chrome.runtime.lastError.message);
              } else {
                logger(`已从预览账号列表中移除账号 @${account.username}`);
              }
            });
          }
        });
      } catch (error) {
        // 只记录错误但不影响执行流程
        logger(`处理预览账号列表时出错: ${error.message}`);
      }
      
      return true;
    } catch (error) {
      logger(`从列表中移除账号时出错: ${error.message}`);
      // 返回成功，避免中断主流程
      return true;
    }
  };

  // 显示确认对话框
  const showConfirmationDialog = async () => {
    // 检查是否应该自动确认（从storage中读取设置）
    const autoConfirm = await new Promise(resolve => {
      try {
        chrome.storage.local.get(['autoConfirm'], (result) => {
          if (chrome.runtime.lastError) {
            console.log('读取自动确认设置时出错:', chrome.runtime.lastError);
            resolve(false);
            return;
          }
          resolve(result.autoConfirm === true);
        });
      } catch (error) {
        console.log('获取自动确认设置时出错:', error);
        resolve(false);
      }
    });
    
    // 如果设置了自动确认，跳过对话框直接返回true
    if (autoConfirm) {
      console.log('自动确认已启用，跳过确认对话框');
      return true;
    }
    
    return new Promise((resolve) => {
      try {
        // 创建对话框元素
        const dialogOverlay = document.createElement('div');
        dialogOverlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          z-index: 10000;
          display: flex;
          justify-content: center;
          align-items: center;
          opacity: 0;
          transition: opacity 0.3s ease;
        `;
        
        const dialogBox = document.createElement('div');
        dialogBox.style.cssText = `
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          background: white;
          border-radius: 16px;
          padding: 20px;
          overflow-y: auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          transform: translateY(20px);
          transition: transform 0.3s ease;
          box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
        `;
        
        // 标题
        const title = document.createElement('h2');
        title.style.cssText = `
          margin: 0 0 15px 0;
          color: #14171A;
          font-size: 20px;
          font-weight: 700;
          text-align: center;
        `;
        title.textContent = '确认取消关注以下账号';
        dialogBox.appendChild(title);
        
        // 说明文字
        const description = document.createElement('p');
        description.style.cssText = `
          margin: 0 0 15px 0;
          color: #657786;
          font-size: 14px;
          line-height: 1.5;
          text-align: center;
        `;
        description.innerHTML = '将取消关注以下账号。<strong>即使扩展窗口关闭，任务也会在后台继续执行。</strong>';
        dialogBox.appendChild(description);
        
        // 账号列表
        const accountsList = document.createElement('div');
        accountsList.style.cssText = `
          max-height: 300px;
          overflow-y: auto;
          margin-bottom: 20px;
          border: 1px solid #E1E8ED;
          border-radius: 8px;
          padding: 5px 0;
        `;
        
        remainingAccounts.forEach((account, index) => {
          const accountItem = document.createElement('div');
          accountItem.style.cssText = `
            padding: 10px 15px;
            display: flex;
            align-items: center;
            border-bottom: ${index < remainingAccounts.length - 1 ? '1px solid #E1E8ED' : 'none'};
          `;
          
          const accountText = document.createElement('div');
          accountText.style.cssText = `
            flex: 1;
          `;
          accountText.innerHTML = `<strong>${account.displayName}</strong> <span style="color: #657786;">@${account.username}</span>`;
          accountItem.appendChild(accountText);
          
          accountsList.appendChild(accountItem);
        });
        
        dialogBox.appendChild(accountsList);
        
        // 统计信息
        const stats = document.createElement('p');
        stats.style.cssText = `
          margin: 10px 0;
          color: #14171A;
          font-size: 14px;
          text-align: center;
          font-weight: 600;
        `;
        stats.textContent = `共 ${remainingAccounts.length} 个账号将被取消关注`;
        dialogBox.appendChild(stats);
        
        // 添加自动确认选项
        const autoConfirmContainer = document.createElement('div');
        autoConfirmContainer.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 15px 0;
        `;
        
        const autoConfirmCheckbox = document.createElement('input');
        autoConfirmCheckbox.type = 'checkbox';
        autoConfirmCheckbox.id = 'autoConfirmCheckbox';
        autoConfirmCheckbox.style.cssText = `
          margin-right: 8px;
        `;
        
        const autoConfirmLabel = document.createElement('label');
        autoConfirmLabel.htmlFor = 'autoConfirmCheckbox';
        autoConfirmLabel.textContent = '下次自动确认（不再显示此对话框）';
        autoConfirmLabel.style.cssText = `
          font-size: 14px;
          color: #657786;
        `;
        
        autoConfirmContainer.appendChild(autoConfirmCheckbox);
        autoConfirmContainer.appendChild(autoConfirmLabel);
        dialogBox.appendChild(autoConfirmContainer);
        
        // 按钮区域
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
          display: flex;
          justify-content: space-between;
          margin-top: 20px;
          gap: 15px;
        `;
        
        const cancelButton = document.createElement('button');
        cancelButton.style.cssText = `
          flex: 1;
          padding: 12px 15px;
          border: none;
          border-radius: 24px;
          background-color: #E1E8ED;
          color: #14171A;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          justify-content: center;
          align-items: center;
          transition: background-color 0.2s ease;
        `;
        cancelButton.textContent = '取消';
        cancelButton.addEventListener('mouseover', () => {
          cancelButton.style.backgroundColor = '#d1d8ed';
        });
        cancelButton.addEventListener('mouseout', () => {
          cancelButton.style.backgroundColor = '#E1E8ED';
        });
        cancelButton.addEventListener('click', () => {
          // 添加退出动画
          dialogOverlay.style.opacity = '0';
          dialogBox.style.transform = 'translateY(20px)';
          
          setTimeout(() => {
            if (document.body.contains(dialogOverlay)) {
              document.body.removeChild(dialogOverlay);
            }
            resolve(false);
          }, 300);
        });
        
        const confirmButton = document.createElement('button');
        confirmButton.style.cssText = `
          flex: 1;
          padding: 12px 15px;
          border: none;
          border-radius: 24px;
          background-color: #E0245E;
          color: white;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          justify-content: center;
          align-items: center;
          transition: background-color 0.2s ease;
        `;
        confirmButton.textContent = '确认取消关注';
        confirmButton.addEventListener('mouseover', () => {
          confirmButton.style.backgroundColor = '#d01a4e';
        });
        confirmButton.addEventListener('mouseout', () => {
          confirmButton.style.backgroundColor = '#E0245E';
        });
        confirmButton.addEventListener('click', () => {
          console.log('确认按钮被点击');
          
          // 保存自动确认设置
          if (autoConfirmCheckbox.checked) {
            try {
              chrome.storage.local.set({ autoConfirm: true });
            } catch (error) {
              console.log('保存自动确认设置时出错:', error);
            }
          }
          
          // 在移除对话框前设置标志，表示任务已经开始
          try {
            chrome.storage.local.set({ 
              isRunning: true,
              taskStarted: true,
              taskStartTime: Date.now()
            });
          } catch (error) {
            console.log('保存任务状态时出错:', error);
          }
          
          // 添加退出动画
          dialogOverlay.style.opacity = '0';
          dialogBox.style.transform = 'translateY(20px)';
          
          setTimeout(() => {
            if (document.body.contains(dialogOverlay)) {
              document.body.removeChild(dialogOverlay);
            }
            console.log('确认对话框已关闭，返回确认结果');
            resolve(true);
          }, 300);
        });
        
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(confirmButton);
        dialogBox.appendChild(buttonContainer);
        
        dialogOverlay.appendChild(dialogBox);
        document.body.appendChild(dialogOverlay);
        
        // 添加显示动画
        setTimeout(() => {
          dialogOverlay.style.opacity = '1';
          dialogBox.style.transform = 'translateY(0)';
        }, 10);
        
        // 确保对话框被正确关闭 - 即使扩展窗口关闭，也能够继续执行任务
        window.addEventListener('beforeunload', () => {
          const isChecked = autoConfirmCheckbox.checked;
          
          if (isChecked) {
            try {
              chrome.storage.local.set({ autoConfirm: true });
            } catch (error) {
              console.log('窗口关闭时保存自动确认设置出错:', error);
            }
          }
          
          if (document.body.contains(dialogOverlay)) {
            document.body.removeChild(dialogOverlay);
          }
        });
      } catch (error) {
        console.error('显示确认对话框时出错:', error);
        // 出错时默认允许继续执行
        resolve(true);
      }
    });
  };

  // 显示任务完成通知
  const showCompletionNotification = () => {
    try {
      // 在页面上显示完成通知
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #17BF63;
        color: white;
        padding: 15px 20px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-width: 350px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transform: translateY(-20px);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
      `;
      
      const title = document.createElement('div');
      title.style.cssText = `
        font-size: 16px;
        font-weight: 700;
      `;
      title.textContent = '任务已完成！';
      
      const message = document.createElement('div');
      message.style.cssText = `
        margin-top: 5px;
      `;
      message.textContent = `成功取消关注 ${unfollowedCount} 个账号。`;
      
      const closeButton = document.createElement('button');
      closeButton.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        opacity: 0.7;
        line-height: 1;
        padding: 0;
      `;
      closeButton.innerHTML = '×';
      closeButton.title = '关闭通知';
      closeButton.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
        setTimeout(() => {
          if (document.body.contains(notification)) {
            document.body.removeChild(notification);
          }
        }, 300);
      });
      
      notification.appendChild(closeButton);
      notification.appendChild(title);
      notification.appendChild(message);
      
      document.body.appendChild(notification);
      
      // 显示动画
      setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
      }, 10);
      
      // 自动隐藏通知（30秒后）
      setTimeout(() => {
        if (document.body.contains(notification)) {
          notification.style.opacity = '0';
          notification.style.transform = 'translateY(-20px)';
          
          setTimeout(() => {
            if (document.body.contains(notification)) {
              document.body.removeChild(notification);
            }
          }, 300);
        }
      }, 30000);
      
      // 同时尝试使用浏览器通知API（需要权限）
      try {
        if (Notification.permission === 'granted') {
          new Notification('Twitter取消关注任务已完成', {
            body: `成功取消关注 ${unfollowedCount} 个账号。`,
            icon: '/images/icon128.png'
          });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              new Notification('Twitter取消关注任务已完成', {
                body: `成功取消关注 ${unfollowedCount} 个账号。`,
                icon: '/images/icon128.png'
              });
            }
          });
        }
      } catch (error) {
        console.log('不支持浏览器通知:', error);
      }
    } catch (error) {
      console.error('显示完成通知时出错:', error);
    }
  };

  // Listen for stop messages and progress requests
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.action === 'stop') {
        console.log('Received stop task message');
        shouldStop = true;
        updateProgress('Stopping...', true);
        // 立即发送响应，不要使用异步
        sendResponse({success: true, message: 'Task will stop soon'});
      } else if (message.action === 'getProgress') {
        // 准备当前进度
        const progress = {
          type: 'progress',
          totalFound,
          unfollowed: unfollowedCount,
          status: rateLimitPause ? 'Rate limit detected. Waiting...' : 'Running...',
          rateLimited: rateLimitPause
        };
        
        // 直接发送响应，不要使用异步
        sendResponse(progress);
      } else {
        // 处理其他消息类型
        sendResponse({success: false, message: 'Unknown action'});
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
      // 尝试发送错误响应
      try {
        sendResponse({success: false, error: error.message});
      } catch (e) {
        // 忽略二次错误
      }
    }
    // 不返回 true，表示没有异步响应
  });

  // Handle page unload
  window.addEventListener('beforeunload', () => {
    if (!shouldStop) {
      saveTaskState(); // 保存当前任务状态
      updateProgress('Process will continue in background', false);
    }
  });

  // 更新进度条和状态
  function updateProgress(status, completed = false, rateLimited = false) {
    try {
      // 保存到存储以确保即使popup关闭也能恢复
      chrome.storage.local.set({
        progress: {
          totalFound,
          unfollowed: unfollowedCount,
          status,
          completed,
          rateLimited,
          lastUpdateTime: Date.now()
        },
        isRunning: !completed
      });
      
      // 使用try-catch包装消息发送，防止因popup关闭导致的错误中断任务
      try {
        chrome.runtime.sendMessage({
          type: 'progress',
          totalFound,
          unfollowed: unfollowedCount,
          status,
          completed,
          rateLimited
        }, response => {
          // 为防止错误，不检查response
          if (chrome.runtime.lastError) {
            // 静默忽略错误
            console.log('更新进度时出现通信错误，但任务将继续运行');
          }
        });
      } catch (error) {
        // 忽略消息发送错误，让任务继续运行
        console.log('发送进度消息失败，但任务将继续: ' + error.message);
      }
    } catch (error) {
      console.error('更新进度时出错:', error);
      // 不抛出异常，确保流程继续
    }
  }

  // Wait for an element to appear with timeout
  const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkElement = () => {
        const element = document.querySelector(selector);
        if (element) resolve(element);
        else if (Date.now() - startTime > timeout) reject(new Error(`Timeout waiting for ${selector}`));
        else if (shouldStop) reject(new Error('Process stopped by user'));
        else setTimeout(checkElement, 100);
      };
      checkElement();
    });
  };

  // Delay function with random jitter
  const delay = (ms) => new Promise(resolve => {
    const timeout = setTimeout(resolve, ms + (Math.random() * 500));
    if (shouldStop) clearTimeout(timeout);
  });

  // Handle rate limiting
  async function handleRateLimit() {
    rateLimitPause = true;
    updateProgress('Rate limit detected. Waiting 5 minutes...', false, true);
    await delay(300000); // 5 minute delay
    consecutiveErrors = 0;
    rateLimitPause = false;
  }

  // Scroll to element function
  const scrollToElement = (element) => {
    if (!element) return Promise.resolve();
    
    try {
      // 直接使用 auto 行为进行即时滚动，不需要平滑动画
      element.scrollIntoView({ 
        behavior: 'auto', 
        block: 'center' 
      });
      
      // 超快速模式下几乎不等待
      return delay(config && config.ultraFastMode ? 200 : 300);
    } catch (e) {
      console.error('滚动到元素时出错:', e);
      return Promise.resolve();
    }
  };

  // Extract username from current URL
  function getCurrentUsername() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(part => part);
    return parts[0];
  }

  // Check if we're on a valid profile or following page
  function isValidPage() {
    const path = window.location.pathname;
    const username = getCurrentUsername();
    return username && (path.endsWith('/following') || path === `/${username}`);
  }

  // Navigate to following page if needed
  async function ensureFollowingPage() {
    if (!window.location.pathname.endsWith('/following')) {
      const username = getCurrentUsername();
      if (!username) {
        throw new Error('Could not determine username from URL');
      }
      updateProgress('Navigating to following page...');
      window.location.href = `${window.location.origin}/${username}/following`;
      await delay(3000); // Wait for navigation
      return true; // Page was changed
    }
    return false; // Already on following page
  }
  
  // 添加全局辅助函数，用于调试日志记录
  function createDebugLogger(username) {
    const logPrefix = username ? `[${username}]` : '[Debug]';
    
    const handleRuntimeError = (error) => {
      if (error && error.message && (
          error.message.includes('Extension context invalidated') ||
          error.message.includes('context invalidated') ||
          error.message.includes('connection closed') ||
          error.message.includes('message channel closed') ||
          error.message.includes('message port closed')
      )) {
        console.log(`${logPrefix} 弹窗可能已关闭，但任务将继续执行...`);
        return true; // 忽略此类错误
      }
      return false; // 其他错误仍然需要处理
    };

    return function(message) {
      const logMessage = `${logPrefix} ${message}`;
      console.log(logMessage);
      
      // 保存日志到存储，这样即使弹窗关闭也能保留最新状态
      try {
        chrome.storage.local.get(['unfollowLogs'], (result) => {
          const logs = result.unfollowLogs || [];
          logs.push({
            timestamp: Date.now(),
            username: username || 'Global',
            message: message
          });
          
          // 只保留最近的100条日志
          const recentLogs = logs.slice(-100);
          chrome.storage.local.set({ unfollowLogs: recentLogs });
        });
      } catch (error) {
        // 忽略存储错误，不影响主要功能
        handleRuntimeError(error);
      }
    };
  }

  // 创建一个全局日志记录器
  const globalDebugLog = createDebugLogger('Global');

  // 在现有的 delay 函数下方添加一个配置对象
  const config = {
    // 滚动和延迟配置
    scrollDelay: 800,       // 普通滚动等待时间 (ms)
    buttonDelay: 800,       // 按钮点击等待时间 (ms)
    confirmDelay: 1000,     // 确认操作等待时间 (ms)
    scrollStep: 1.2,        // 滚动步长倍数 (相对于屏幕高度)
    fastMode: true,         // 是否启用快速模式
    fastScrollStep: 2.5,    // 快速模式滚动步长倍数
    fastScrollDelay: 400,   // 快速模式滚动等待时间 (ms)
    
    // 超快速模式配置
    ultraFastMode: true,    // 是否启用超快速模式
    ultraScrollStep: 4.0,   // 超快速模式滚动步长倍数
    ultraScrollDelay: 250,  // 超快速滚动等待时间 (ms)
    checkInterval: 3,       // 超快速模式下每隔几次滚动检查一次
    
    // 稳定性和重试配置
    maxUnchangedCount: 8,   // 高度不变次数阈值 (减少等待时间)
    batchSize: 3,           // 每批处理的账号数
    searchDelay: 1000       // 账号处理间隔时间
  };

  // 添加超快速滚动函数
  async function fastScroll(distance, maxScrolls, debugLog, checkForAccounts) {
    const logger = debugLog || globalDebugLog;
    let scrollCount = 0;
    let lastHeight = document.body.scrollHeight;
    let unchangedHeightCount = 0;
    
    logger('开始超快速滚动...');
    
    while (scrollCount < maxScrolls && unchangedHeightCount < 5 && !shouldStop) {
      scrollCount++;
      
      // 执行滚动
      window.scrollBy(0, distance);
      await delay(config.ultraScrollDelay);
      
      // 检查页面高度是否变化
      const currentHeight = document.body.scrollHeight;
      
      if (currentHeight === lastHeight) {
        unchangedHeightCount++;
      } else {
        unchangedHeightCount = 0;
        lastHeight = currentHeight;
      }
      
      // 每隔特定次数检查一次是否有账号可处理
      if (checkForAccounts && scrollCount % config.checkInterval === 0) {
        logger(`快速滚动 #${scrollCount}, 检查是否有账号...`);
        const found = await searchAllVisibleAccounts(debugLog);
        if (found) {
          logger('在快速滚动中发现账号并已处理！');
          return true; // 找到并处理了账号
        }
      }
    }
    
    logger(`超快速滚动完成，执行了 ${scrollCount} 次滚动`);
    return false; // 未找到或处理账号
  }

  // 修改 findAndUnfollowAccount 函数的滚动部分
  async function findAndUnfollowAccount(account) {
    // 创建账号特定的日志记录器
    const addDebugLog = createDebugLogger(account.username);
    
    // 增强错误处理，防止弹窗关闭导致的通信中断
    const handleRuntimeError = (error) => {
      if (error && error.message && (
          error.message.includes('Extension context invalidated') ||
          error.message.includes('context invalidated') ||
          error.message.includes('connection closed')
      )) {
        addDebugLog('弹窗可能已关闭，但任务将继续执行...');
        return true; // 忽略此类错误
      }
      return false; // 其他错误仍然需要处理
    };
    
    addDebugLog(`尝试取消关注 ${account.displayName} (@${account.username})`);
    
    try {
      // 确保状态更新保存到存储
      try {
        chrome.storage.local.set({
          progress: {
            status: `正在寻找账号: @${account.username}...`,
            totalFound,
            unfollowed: unfollowedCount,
            lastUpdateTime: Date.now()
          }
        });
      } catch (error) {
        handleRuntimeError(error);
      }
      
      // 步骤1: 在当前视图中查找特定账号
      let found = await searchCurrentView(account, addDebugLog);
      if (found) return true;

      // 步骤2: 尝试在当前视图中搜索所有待取消关注的账号
      addDebugLog('在当前视图中未找到目标账号，先检查是否有其他待取消关注的账号...');
      found = await searchAllVisibleAccounts(addDebugLog);
      if (found) {
        addDebugLog('找到并取消关注了其他账号，本次查找视为成功');
        return true;
      }

      // 步骤3: 如果未找到任何账号，使用超快速滚动策略
      if (config.ultraFastMode) {
        addDebugLog('未找到账号，开始超快速滚动搜索...');
        
        // 计算超快速滚动距离
        const scrollDistance = window.innerHeight * config.ultraScrollStep;
        
        // 执行超快速滚动 (最多20次滚动)，并检查账号
        found = await fastScroll(scrollDistance, 20, addDebugLog, true);
        if (found) {
          addDebugLog('在超快速滚动中找到并处理了账号！');
          return true;
        }
        
        // 如果没找到，再执行一次超快速滚动并检查特定账号
        found = await fastScroll(scrollDistance, 20, addDebugLog, true);
        if (found) {
          addDebugLog('在第二轮超快速滚动中找到并处理了账号！');
          return true;
        }
      }
      
      // 步骤4: 如果超快速滚动未找到账号，使用常规滚动搜索
      addDebugLog('开始常规滚动搜索...');
      
      // 向下滚动查找
      let reachedBottom = false;
      let scrollCount = 0;
      let unchangedHeightCount = 0;
      let lastHeight = document.body.scrollHeight;
      
      // 根据是否启用快速模式选择滚动步长和延迟
      const scrollStep = config.fastMode 
        ? window.innerHeight * config.fastScrollStep 
        : window.innerHeight * config.scrollStep;
      
      const scrollDelay = config.fastMode
        ? config.fastScrollDelay
        : config.scrollDelay;
        
      const maxUnchangedCount = config.maxUnchangedCount;
      
      // 只执行最多10次常规滚动
      while (!reachedBottom && !shouldStop && unchangedHeightCount < maxUnchangedCount && scrollCount < 10) {
        scrollCount++;
        
        try {
          // 快速滚动时，每3次才执行一次账号搜索，节省时间
          const shouldCheckAccounts = scrollCount % 2 === 0;
          
          // 向下滚动
          window.scrollBy(0, scrollStep);
          await delay(scrollDelay);
          
          // 检查页面高度是否变化
          const currentHeight = document.body.scrollHeight;
          addDebugLog(`常规滚动 #${scrollCount}, 当前高度: ${currentHeight}px, 上次高度: ${lastHeight}px`);
          
          if (currentHeight === lastHeight) {
            unchangedHeightCount++;
            addDebugLog(`页面高度未变化 (${unchangedHeightCount}/${maxUnchangedCount})`);
            
            // 尝试不同滚动策略，防止卡住
            if (unchangedHeightCount % 2 === 0) {
              addDebugLog("尝试不同的滚动方式...");
              window.scrollTo(0, window.scrollY + scrollStep * 0.5);
              await delay(scrollDelay / 2);
            }
          } else {
            unchangedHeightCount = 0;
            lastHeight = currentHeight;
          }
          
          // 只在需要时检查账号，减少不必要的DOM操作
          if (shouldCheckAccounts) {
            // 尝试搜索所有可见的待取消关注账号
            found = await searchAllVisibleAccounts(addDebugLog);
            if (found) {
              addDebugLog(`在常规滚动 #${scrollCount} 时找到并取消关注了账号`);
              return true;
            }
            
            // 如果没有找到任何账号，再特定查找当前目标账号
            found = await searchCurrentView(account, addDebugLog);
            if (found) {
              addDebugLog(`在常规滚动 #${scrollCount} 时找到目标账号并取消关注成功`);
              return true;
            }
          }
          
          // 检查是否已经到达底部 (高度不变或页面底部可见)
          if (unchangedHeightCount >= maxUnchangedCount) {
            addDebugLog(`连续${maxUnchangedCount}次滚动页面高度未变化，认为已到达底部`);
            reachedBottom = true;
          }
        } catch (error) {
          if (!handleRuntimeError(error)) {
            addDebugLog(`滚动过程中发生错误: ${error.message}`);
            // 继续尝试，不中断流程
            await delay(config.scrollDelay);
          }
        }
      }
      
      // 如果到达底部仍未找到
      addDebugLog('已完成所有滚动搜索，未找到要取消关注的账号');
      return false;
    } catch (error) {
      if (!handleRuntimeError(error)) {
        console.error(`处理账号 ${account.username} 时出错:`, error);
      }
      return false;
    }
  }
  
  // 辅助函数：在当前视图中搜索特定账号
  async function searchCurrentView(account, debugLog) {
    // 使用传入的日志函数或默认全局日志
    const addDebugLog = debugLog || createDebugLogger(account.username);
    
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"], [data-testid="UserCell"]');
    
    for (const cell of cells) {
      if (findUsernameInCell(cell, account.username)) {
        addDebugLog('找到目标账号');
        
        // 找到关注按钮
        const followButton = findFollowButton(cell);
        if (!followButton) {
          addDebugLog('未找到关注按钮');
          return false;
        }
        
        // 滚动到按钮位置
        await scrollToElement(followButton);
        await delay(config.buttonDelay / 2); // 减少等待时间
        
        // 点击关注按钮
        followButton.click();
        addDebugLog('已点击关注按钮');
        await delay(config.buttonDelay);
        
        // 检查确认对话框并确认
        const confirmButtons = document.querySelectorAll('[data-testid="confirmationSheetConfirm"]');
        if (confirmButtons.length > 0) {
          addDebugLog('找到确认按钮，点击中...');
          confirmButtons[0].click();
          addDebugLog('已确认取消关注');
          
          // 等待确认按钮消失或状态变化
          await delay(config.confirmDelay);
          
          // 更新计数和列表
          unfollowedCount++;
          await removeAccountAndSave(account);
          
          await saveTaskState();
          updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
          return true;
        } else {
          // 尝试其他确认按钮
          const altConfirmButtons = document.querySelectorAll('[data-testid="unfollow"]');
          if (altConfirmButtons.length > 0) {
            addDebugLog('找到替代确认按钮，点击中...');
            altConfirmButtons[0].click();
            addDebugLog('已确认取消关注');
            
            // 等待确认按钮消失
            await delay(config.confirmDelay);
            
            // 更新计数和列表
            unfollowedCount++;
            await removeAccountAndSave(account);
            
            await saveTaskState();
            updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
            return true;
          }
          
          addDebugLog('未找到确认按钮');
          return false;
        }
      }
    }
    
    return false; // 当前视图中未找到
  }
  
  // 辅助函数：搜索当前视图中所有待取消关注的账号
  async function searchAllVisibleAccounts(debugLog) {
    // 使用传入的日志函数或默认全局日志
    const addDebugLog = debugLog || globalDebugLog;
    
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"], [data-testid="UserCell"]');
    let foundAny = false;
    let processedCount = 0; // 记录处理的账号数量
    
    // 改进高亮单元格检测逻辑，更加宽松地匹配黄色背景
    const highlightedCells = Array.from(cells).filter(cell => {
      const bgColor = cell.style.backgroundColor;
      // 更宽松地匹配任何含有黄色的背景色
      return bgColor && (
        bgColor.includes('255, 255, 0') || // rgba格式
        bgColor.includes('yellow') ||      // 命名颜色
        bgColor.includes('rgb(255, 255')   // 任何接近黄色的RGB值
      );
    });
    
    if (highlightedCells.length > 0) {
      addDebugLog(`找到 ${highlightedCells.length} 个高亮显示的单元格，尝试取消关注所有符合条件的账号...`);
      
      // 处理所有高亮单元格
      for (const cell of highlightedCells) {
        if (shouldStop) break;
        
        // 提取用户名
        const cellUsername = getUsernameFromCell(cell);
        if (!cellUsername) {
          addDebugLog('无法从高亮单元格提取用户名，跳过');
          continue;
        }
        
        // 确认在待取消关注列表中
        const targetAccount = remainingAccounts.find(acc => acc.username === cellUsername);
        if (!targetAccount) {
          addDebugLog(`高亮的账号 @${cellUsername} 不在待取消关注列表中，可能已处理，跳过`);
          continue;
        }
        
        // 为当前处理的账号创建一个特定的日志记录器
        const accountLog = createDebugLogger(cellUsername);
        accountLog(`尝试取消关注高亮账号 @${cellUsername}`);
        
        // 找到关注按钮
        const followButton = findFollowButton(cell);
        if (!followButton) {
          accountLog(`未在高亮单元格中找到关注按钮，跳过 @${cellUsername}`);
          continue;
        }
        
        // 滚动到按钮位置
        await scrollToElement(followButton);
        await delay(config.buttonDelay / 2); // 减少等待时间
        
        // 点击关注按钮
        followButton.click();
        accountLog('已点击关注按钮');
        await delay(config.buttonDelay);
        
        // 检查确认对话框并确认
        const confirmButtons = document.querySelectorAll('[data-testid="confirmationSheetConfirm"]');
        if (confirmButtons.length > 0) {
          accountLog('找到确认按钮，点击中...');
          confirmButtons[0].click();
          accountLog(`已确认取消关注 @${cellUsername}`);
          
          // 等待确认按钮消失
          await delay(config.confirmDelay);
          
          // 更新计数和列表
          unfollowedCount++;
          await removeAccountAndSave(targetAccount);
          
          await saveTaskState();
          updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
          foundAny = true;
          processedCount++;
          // 继续处理下一个账号
        } else {
          // 尝试其他确认按钮
          const altConfirmButtons = document.querySelectorAll('[data-testid="unfollow"]');
          if (altConfirmButtons.length > 0) {
            accountLog('找到替代确认按钮，点击中...');
            altConfirmButtons[0].click();
            accountLog(`已确认取消关注 @${cellUsername}`);
            
            // 等待确认按钮消失
            await delay(config.confirmDelay);
            
            // 更新计数和列表
            unfollowedCount++;
            await removeAccountAndSave(targetAccount);
            
            await saveTaskState();
            updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
            foundAny = true;
            processedCount++;
            // 继续处理下一个账号
          }
          
          accountLog('未找到确认按钮，跳过此账号');
        }
      }
    }
    
    // 处理完所有高亮账号后，再处理非高亮账号
    // 移除这个条件判断，无论是否找到高亮账号都处理非高亮账号
    // if (!foundAny) {
    
    // 基于用户名查找待取消关注的账号
    addDebugLog('开始基于用户名查找待取消关注的账号...');
    
    // 创建一个已处理用户名的集合，避免重复处理
    const processedUsernames = new Set();
    // 将已处理过的高亮账号添加到集合中
    highlightedCells.forEach(cell => {
      const username = getUsernameFromCell(cell);
      if (username) processedUsernames.add(username);
    });
    
    // 遍历所有单元格，检查是否有待取消关注的账号
    for (const cell of cells) {
      if (shouldStop) break;
      
      const cellUsername = getUsernameFromCell(cell);
      if (!cellUsername || processedUsernames.has(cellUsername)) continue; // 跳过已处理的账号
      
      // 添加到已处理集合
      processedUsernames.add(cellUsername);
      
      // 检查是否在待处理列表中
      const targetAccount = remainingAccounts.find(acc => acc.username === cellUsername);
      if (!targetAccount) continue;
      
      // 为当前处理的账号创建一个特定的日志记录器
      const accountLog = createDebugLogger(cellUsername);
      accountLog(`找到待取消关注账号: @${cellUsername}`);
      
      // 找到关注按钮
      const followButton = findFollowButton(cell);
      if (!followButton) {
        accountLog('未找到关注按钮');
        continue;
      }
      
      // 滚动到按钮位置
      await scrollToElement(followButton);
      await delay(config.buttonDelay / 2); // 减少等待时间
      
      // 点击关注按钮
      followButton.click();
      accountLog('已点击关注按钮');
      await delay(config.buttonDelay);
      
      // 检查确认对话框并确认
      const confirmButtons = document.querySelectorAll('[data-testid="confirmationSheetConfirm"]');
      if (confirmButtons.length > 0) {
        accountLog('找到确认按钮，点击中...');
        confirmButtons[0].click();
        accountLog(`已确认取消关注 @${cellUsername}`);
        
        // 等待确认按钮消失
        await delay(config.confirmDelay);
        
        // 更新计数和列表
        unfollowedCount++;
        await removeAccountAndSave(targetAccount);
        
        await saveTaskState();
        updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
        processedCount++;
        foundAny = true;
        // 继续处理下一个账号
      } else {
        // 尝试其他确认按钮
        const altConfirmButtons = document.querySelectorAll('[data-testid="unfollow"]');
        if (altConfirmButtons.length > 0) {
          accountLog('找到替代确认按钮，点击中...');
          altConfirmButtons[0].click();
          accountLog(`已确认取消关注 @${cellUsername}`);
          
          // 等待确认按钮消失
          await delay(config.confirmDelay);
          
          // 更新计数和列表
          unfollowedCount++;
          await removeAccountAndSave(targetAccount);
          
          await saveTaskState();
          updateProgress(`已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个...`);
          processedCount++;
          foundAny = true;
          // 继续处理下一个账号
        }
        
        accountLog('未找到确认按钮');
      }
    }
    // }
    
    // 返回是否找到并处理了任何账号
    if (processedCount > 0) {
      addDebugLog(`本次成功处理了 ${processedCount} 个账号`);
    }
    return foundAny;
  }
  
  // 找到单元格中的用户名
  function findUsernameInCell(cell, username) {
    try {
      // 方法1: 检查用户名链接
      const usernameLinkElements = cell.querySelectorAll('a[role="link"]');
      for (const element of usernameLinkElements) {
        const href = element.getAttribute('href');
        if (href && href === `/${username}`) {
          return true;
        }
      }
      
      // 方法2: 检查用户名文本
      const usernameElements = cell.querySelectorAll('div[dir="ltr"] span');
      for (const element of usernameElements) {
        const text = element.textContent.trim();
        if (text === `@${username}`) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.log(`查找用户名时出错: ${error.message}`);
      return false;
    }
  }
  
  // 找到关注按钮
  function findFollowButton(cell) {
    try {
      // 方法1: 检查aria-label属性
      const buttons = cell.querySelectorAll('[role="button"]');
      for (const button of buttons) {
        const ariaLabel = button.getAttribute('aria-label');
        if (ariaLabel && (ariaLabel.includes('Following') || ariaLabel.includes('已关注') || 
                          ariaLabel.includes('正在关注'))) {
          return button;
        }
      }
      
      // 方法2: 检查按钮文本
      const allButtons = cell.querySelectorAll('div[role="button"], button');
      for (const button of allButtons) {
        const text = button.textContent || '';
        if (text.includes('正在关注') || text.includes('Following')) {
          return button;
        }
      }
      
      return null;
    } catch (error) {
      console.log(`查找关注按钮时出错: ${error.message}`);
      return null;
    }
  }

  // 主流程
  async function main() {
    // 使用全局日志记录器
    const mainLogger = createDebugLogger('Main');
    
    try {
      // 设置一个心跳机制，防止任务被挂起
      let heartbeatInterval = null;
      const startHeartbeat = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        
        heartbeatInterval = setInterval(() => {
          try {
            chrome.storage.local.set({ 
              lastHeartbeat: Date.now(),
              remainingAccountsCount: remainingAccounts.length,
              unfollowedCount: unfollowedCount
            });
          } catch (error) {
            // 忽略存储错误
          }
        }, 10000); // 每10秒更新一次心跳
      };
      
      // 启动心跳
      startHeartbeat();
      
      // 添加弹性错误处理，防止弹窗关闭导致的通信中断
      const handleRuntimeError = (error) => {
        if (error && error.message && (
            error.message.includes('Extension context invalidated') ||
            error.message.includes('context invalidated') ||
            error.message.includes('connection closed') ||
            error.message.includes('message channel closed') ||
            error.message.includes('message port closed') ||
            error.message.includes('Could not establish connection') ||
            error.message.includes('Receiving end does not exist')
        )) {
          mainLogger('扩展窗口可能已关闭，但任务将继续执行...');
          return true; // 忽略此类错误
        }
        return false; // 其他错误仍然需要处理
      };
      
      // 增强版进度更新函数，提高弹性
      const safeUpdateProgress = (status, completed = false, rateLimited = false) => {
        try {
          // 只保存到存储，不再尝试发送消息
          chrome.storage.local.set({
            progress: {
              type: 'progress',
              totalFound,
              unfollowed: unfollowedCount,
              status,
              completed,
              rateLimited,
              lastUpdateTime: Date.now()
            },
            isRunning: !completed
          });
        } catch (error) {
          mainLogger('保存进度到存储失败：' + error.message);
        }
      };
      
      // 临时替换标准updateProgress函数
      const originalUpdateProgress = updateProgress;
      updateProgress = safeUpdateProgress;
      
      // 恢复之前的任务状态（如果有）
      const hasExistingTask = await loadSavedTask();
      
      // 日志任务状态
      mainLogger('当前任务状态: ' + (hasExistingTask ? '已有保存的任务' : '新任务'));
      mainLogger('待处理账号数量: ' + remainingAccounts.length);
      
      // 只有在没有恢复任务的情况下才显示确认对话框
      if (!hasExistingTask) {
        mainLogger('准备显示确认对话框...');
        
        // 验证当前页面
        if (!isValidPage()) {
          const message = '请导航到Twitter/X个人资料或关注页面再试。';
          alert(message);
          updateProgress(message, true);
          return;
        }

        // 确保我们在关注页面
        const didNavigate = await ensureFollowingPage();
        if (didNavigate) {
          // 等待页面加载
          try {
            await waitForElement('[data-testid="primaryColumn"]', 10000);
          } catch (error) {
            updateProgress('错误: 无法加载关注页面。请刷新后重试。', true);
            return;
          }
        }

        // 显示确认对话框
        mainLogger('显示确认对话框...');
        
        let confirmed = false;
        try {
          confirmed = await showConfirmationDialog();
        } catch (error) {
          // 即使确认对话框出错，也继续执行
          mainLogger('确认对话框出错，但将继续执行: ' + error.message);
          // 检查是否已经开始执行任务
          const taskStarted = await new Promise(resolve => {
            try {
              chrome.storage.local.get(['taskStarted'], (result) => {
                resolve(result.taskStarted === true);
              });
            } catch (e) {
              resolve(false);
            }
          });
          
          if (taskStarted) {
            confirmed = true;
          }
        }
        
        mainLogger('确认对话框结果: ' + (confirmed ? '用户确认' : '用户取消'));
        
        if (!confirmed) {
          try {
            // 确保任务被标记为已完成
            chrome.storage.local.set({ isRunning: false, taskStarted: false });
          } catch (error) {
            // 忽略错误
          }
          updateProgress('用户取消了操作', true);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          return;
        }
      }

      // 既然任务已确认，记录开始时间
      try {
        chrome.storage.local.set({ 
          taskStartTime: Date.now(),
          isRunning: true
        });
      } catch (error) {
        // 忽略存储错误
      }

      safeUpdateProgress(`准备取消关注 ${remainingAccounts.length} 个账号...`);
      
      // 初始化超速处理计数
      let emptyBatchCount = 0;
      let noProgressCount = 0;
      let lastUnfollowedCount = unfollowedCount;
      
      // 优先使用超快速模式先扫描大部分页面
      if (config.ultraFastMode && remainingAccounts.length > 10) {
        mainLogger('使用超快速预扫描模式...');
        
        // 初始超快速扫描，查找所有可见的待取消关注账号
        let initialFound = await searchAllVisibleAccounts(mainLogger);
        if (initialFound) {
          mainLogger('在当前视图找到并处理了账号');
        }
        
        // 尝试超快速滚动多次，以覆盖更多页面
        for (let i = 0; i < 3 && !shouldStop; i++) {
          mainLogger(`执行第 ${i+1}/3 轮超快速预扫描...`);
          
          const scrollDistance = window.innerHeight * config.ultraScrollStep;
          await fastScroll(scrollDistance, 30, mainLogger, true);
          
          // 如果处理了足够多的账号，或者已经在底部了，可以提前退出
          if (unfollowedCount - lastUnfollowedCount > 5) {
            mainLogger(`已在超快速扫描中取消关注 ${unfollowedCount - lastUnfollowedCount} 个账号，继续常规处理`);
            break;
          }
        }
        
        // 更新状态
        lastUnfollowedCount = unfollowedCount;
      }
      
      // 创建账号处理批次
      while (remainingAccounts.length > 0 && !shouldStop) {
        // 处理频率限制
        if (rateLimitPause) {
          await handleRateLimit();
          continue;
        }
        
        // 获取当前批次的账号 (超快速模式使用更大批次)
        const batchSize = config.ultraFastMode ? config.batchSize * 2 : config.batchSize;
        const currentBatch = remainingAccounts.slice(0, batchSize);
        
        mainLogger(`开始处理一批 ${currentBatch.length} 个账号...`);
        let batchSuccess = false;
        
        // 先尝试在当前视图查找并处理任何可见的账号
        let found = await searchAllVisibleAccounts(mainLogger);
        if (found) {
          mainLogger('已在当前视图中找到并处理了账号');
          batchSuccess = true;
          emptyBatchCount = 0;
          // 继续处理下一批，不需要单独处理每个账号
          continue;
        }
        
        // 处理当前批次中的账号
        let batchProcessed = 0;
        // 如果当前视图没有可处理的账号，则尝试找具体的账号
        for (const account of currentBatch) {
          if (shouldStop) break;
          
          const accountLogger = createDebugLogger(account.username);
          let success = false;
          let retryCount = 0;
          
          // 尝试最多2次查找该账号 (超快速模式只尝试1次)
          const maxRetries = config.ultraFastMode ? 1 : 2;
          while (retryCount < maxRetries && !success && !shouldStop) {
            try {
              success = await findAndUnfollowAccount(account);
              if (success) {
                batchSuccess = true;
                batchProcessed++;
                consecutiveErrors = 0;
                break; // 成功找到并处理了此账号，继续下一个
              } else {
                retryCount++;
                if (retryCount < maxRetries) {
                  accountLogger(`尝试第 ${retryCount+1}/${maxRetries} 次查找账号 @${account.username}...`);
                  await delay(800); // 短暂延迟后重试
                }
              }
            } catch (error) {
              if (handleRuntimeError(error)) {
                accountLogger('忽略扩展上下文错误，继续执行...');
              } else {
                console.error(`处理账号 @${account.username} 时出错:`, error);
                retryCount++;
                await delay(800);
              }
            }
          }
          
          // 如果经过尝试仍未找到，则从列表中移除
          if (!success) {
            accountLogger(`无法找到账号 @${account.username}，跳过但保留在待处理列表中`);
            // 注释掉下面这行，以保留账号在待处理列表中
            // await removeAccountAndSave(account);
            
            // 将账号移动到列表末尾重新排队，而不是完全移除
            remainingAccounts = remainingAccounts.filter(a => a.username !== account.username);
            remainingAccounts.push(account);
            
            // 保存更新后的状态
            await saveTaskState();
          }
          
          // 超快速模式下，每处理3个账号进行一次超快速滚动
          if (config.ultraFastMode && batchProcessed > 0 && batchProcessed % 3 === 0) {
            accountLogger('已处理3个账号，执行一次快速滚动...');
            window.scrollBy(0, window.innerHeight * 2.5);
            await delay(400);
          }
        }
        
        // 检查是否有新的取消关注
        const newUnfollows = unfollowedCount - lastUnfollowedCount;
        if (newUnfollows > 0) {
          mainLogger(`本批次成功取消关注 ${newUnfollows} 个账号`);
          lastUnfollowedCount = unfollowedCount;
          noProgressCount = 0;
        } else {
          noProgressCount++;
          mainLogger(`本批次未取消关注任何账号 (${noProgressCount}/3)`);
        }
        
        // 如果此批次有成功处理的账号，批次之间只需短暂延迟
        if (batchSuccess) {
          emptyBatchCount = 0;
          await delay(800);
        } else {
          // 如果连续三批未处理任何账号，可能需要进行更激进的滚动
          emptyBatchCount++;
          mainLogger(`当前区域未找到任何可处理的账号 (${emptyBatchCount}/3)...`);
          
          if (emptyBatchCount >= 3 || noProgressCount >= 3) {
            // 重置计数器
            emptyBatchCount = 0;
            noProgressCount = 0;
            
            // 执行极端滚动，尝试找到新的账号区域
            mainLogger('多次未找到账号，执行超长距离滚动...');
            
            // 使用超快速滚动跳过大段内容
            const longDistance = window.innerHeight * 6;
            await fastScroll(longDistance, 15, mainLogger, true);
            
            // 滚动到新区域后，立即搜索一次
            await searchAllVisibleAccounts(mainLogger);
          } else {
            // 正常的滚动尝试
            mainLogger('滚动到新区域...');
            window.scrollBy(0, window.innerHeight * 3);
            await delay(800);
          }
        }
      }
      
      // 完成了所有账号的处理
      if (remainingAccounts.length === 0) {
        const finalMessage = `完成！成功取消关注 ${unfollowedCount} 个账号。`;
        mainLogger(finalMessage);
        
        // 只清理本地存储，不再发送可能失败的消息
        try {
          // 更新存储状态，将isRunning设置为false并保存最终进度
          chrome.storage.local.set({
            isRunning: false,
            taskStarted: false,
            progress: {
              totalFound,
              unfollowed: unfollowedCount,
              status: finalMessage,
              completed: true
            }
          });
          
          // 清理任务状态
          chrome.storage.local.remove(['unfollowTask']);
        } catch (error) {
          mainLogger('清理存储时出错，可能是扩展上下文已失效');
        }
        
        // 本地显示完成通知而不依赖于popup
        showCompletionNotification();
      } else {
        // 如果任务暂停，更新存储状态但保持isRunning为true
        try {
          chrome.storage.local.set({
            isRunning: true,
            progress: {
              totalFound,
              unfollowed: unfollowedCount,
              status: `暂停：已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个`,
              completed: false
            }
          });
        } catch (error) {
          mainLogger('更新暂停状态时出错');
        }
        safeUpdateProgress(`暂停：已取消关注 ${unfollowedCount} 个账号，还剩 ${remainingAccounts.length} 个`, false);
      }
      
      // 清理心跳
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      
      // 恢复原始的updateProgress函数
      updateProgress = originalUpdateProgress;
    } catch (error) {
      console.error('脚本执行失败:', error);
      try {
        // 确保即使出错也能保存当前状态
        chrome.storage.local.set({
          scriptError: {
            message: error.message,
            stack: error.stack,
            time: Date.now()
          },
          // 不要将isRunning设置为false，允许重新启动
          progress: {
            totalFound,
            unfollowed: unfollowedCount,
            status: `错误: ${error.message}。任务已暂停，可重新启动。`,
            completed: false
          }
        });
      } catch (e) {
        // 忽略存储错误
      }
      
      // 显示本地通知
      try {
        const errorNotification = document.createElement('div');
        errorNotification.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: #E0245E;
          color: white;
          padding: 10px 15px;
          border-radius: 8px;
          font-weight: 600;
          z-index: 10000;
          max-width: 300px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;
        errorNotification.textContent = `错误: ${error.message}。任务已暂停，可重新启动。`;
        document.body.appendChild(errorNotification);
        
        setTimeout(() => {
          if (document.body.contains(errorNotification)) {
            document.body.removeChild(errorNotification);
          }
        }, 10000);
      } catch (e) {
        // 忽略显示错误
      }
    }
  }

  // 启动主流程
  main();
}

// --- 新增高亮相关函数 ---

// 从单元格提取用户名 (复用/修改自 extractAccountInfo)
function getUsernameFromCell(cell) {
    if (!cell || typeof cell.querySelector !== 'function') return null;
    try {
        // 优先尝试从 aria-label 提取 (通常在按钮上)
        const buttonWithLabel = cell.querySelector('button[aria-label*="@"]');
        if (buttonWithLabel) {
            const ariaLabel = buttonWithLabel.getAttribute('aria-label');
            const match = ariaLabel.match(/@([a-zA-Z0-9_]+)/);
            if (match && match[1]) return match[1];
        }

        // 尝试查找用户名链接
        const usernameLink = cell.querySelector('a[href^="/"][role="link"]');
        if (usernameLink) {
            const href = usernameLink.getAttribute('href');
            const parts = href.split('/').filter(Boolean);
            if (parts.length > 0 && /^[a-zA-Z0-9_]+$/.test(parts[0])) {
                return parts[0];
            }
        }

        // 尝试查找包含@的span
        const spans = cell.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent.trim();
            if (text.startsWith('@')) {
                const potentialUsername = text.substring(1);
                if (/^[a-zA-Z0-9_]+$/.test(potentialUsername)) {
                     return potentialUsername;
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error extracting username from cell:', error);
        return null;
    }
}

// 应用或移除高亮
function applyHighlight(element) {
    if (!element || !window.tfHighlightUsernames) return;
    const username = getUsernameFromCell(element);
    
    if (username && window.tfHighlightUsernames.has(username)) {
        // console.log('Applying highlight to:', username);
        element.style.backgroundColor = highlightColor;
    } else {
        // console.log('Removing highlight from:', username || 'element');
        element.style.backgroundColor = ''; // 移除背景色
    }
}

// 初始化观察器并开始高亮
function initializeHighlighting(usernamesToHighlight) {
    console.log('Initializing highlighting for', usernamesToHighlight.size, 'users.');
    stopHighlighting(); // 先确保停止旧的观察器

    window.tfHighlightUsernames = usernamesToHighlight;
    if (window.tfHighlightUsernames.size === 0) {
        console.log('No users to highlight.');
        return; // 没有需要高亮的用户
    }

    // --- Intersection Observer --- 
    window.tfIntersectionObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // console.log('Element intersecting:', getUsernameFromCell(entry.target));
                applyHighlight(entry.target);
            } else {
                // 可选：离开视口时移除高亮（如果性能需要）
                // entry.target.style.backgroundColor = ''; 
            }
        });
    }, {
        root: null, // 使用视口作为根
        threshold: 0.1 // 元素可见10%时触发
    });

    // --- Mutation Observer --- 
    const targetNode = document.querySelector(timelineSelector) || document.body;
    if (!targetNode) {
        console.error('Cannot find target node for MutationObserver');
        return;
    }
    
    window.tfMutationObserver = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                         // 检查添加的节点本身是否是账号单元格
                        if (node.matches && node.matches(accountCellSelector)) {
                             // console.log('New account cell added:', getUsernameFromCell(node));
                             window.tfIntersectionObserver.observe(node);
                             applyHighlight(node); // 立即尝试高亮
                        }
                        // 检查添加的节点的子元素是否包含账号单元格
                        const nestedCells = node.querySelectorAll ? node.querySelectorAll(accountCellSelector) : [];
                        nestedCells.forEach(cell => {
                            // console.log('New nested account cell found:', getUsernameFromCell(cell));
                            window.tfIntersectionObserver.observe(cell);
                            applyHighlight(cell); // 立即尝试高亮
                        });
                    }
                });
                // 可选：处理 removedNodes 以停止观察，提高性能
                mutation.removedNodes.forEach(node => {
                     if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches(accountCellSelector)) {
                            window.tfIntersectionObserver.unobserve(node);
                        }
                        const nestedCells = node.querySelectorAll ? node.querySelectorAll(accountCellSelector) : [];
                        nestedCells.forEach(cell => window.tfIntersectionObserver.unobserve(cell));
                    }
                });
            }
        }
    });

    // 开始观察现有元素
    document.querySelectorAll(accountCellSelector).forEach(cell => {
        window.tfIntersectionObserver.observe(cell);
        applyHighlight(cell); // 对已存在的元素立即应用一次
    });

    // 开始观察DOM变化
    window.tfMutationObserver.observe(targetNode, { childList: true, subtree: true });
    console.log('Highlighting observers started.');
}

// 停止观察并清理高亮
function stopHighlighting() {
    console.log('Stopping highlighting observers...');
    if (window.tfIntersectionObserver) {
        window.tfIntersectionObserver.disconnect();
        window.tfIntersectionObserver = null;
    }
    if (window.tfMutationObserver) {
        window.tfMutationObserver.disconnect();
        window.tfMutationObserver = null;
    }
    // 清理所有可能的背景色
    document.querySelectorAll(accountCellSelector).forEach(cell => {
        if (cell.style.backgroundColor === highlightColor) {
             cell.style.backgroundColor = '';
        }
    });
    window.tfHighlightUsernames = new Set(); // 清空列表
     console.log('Highlighting observers stopped and highlights cleared.');
}

// 设置持久化高亮的主函数
async function setupPersistentHighlighting() {
    console.log('Setting up persistent highlighting...');
    try {
        const data = await new Promise((resolve, reject) => {
            chrome.storage.local.get(['previewAccounts', 'keepList'], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });

        const previewAccounts = data.previewAccounts || [];
        const keepList = new Set(data.keepList || []);
        
        if (previewAccounts.length === 0) {
            console.log('No preview accounts found in storage. Stopping highlighting.');
            stopHighlighting();
            return;
        }

        const usernamesToHighlight = new Set();
        previewAccounts.forEach(account => {
            if (account && account.username && !keepList.has(account.username)) {
                usernamesToHighlight.add(account.username);
            }
        });

        initializeHighlighting(usernamesToHighlight);

    } catch (error) {
        console.error('Error setting up persistent highlighting:', error);
        stopHighlighting(); // 出错时也清理
    }
}

// --- 监听来自 Popup 的消息 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (message.action === 'startHighlighting') {
            console.log('Received startHighlighting message');
            setupPersistentHighlighting();
            sendResponse({ status: "Highlighting started" });
        } else if (message.action === 'stopHighlighting') {
            console.log('Received stopHighlighting message');
            stopHighlighting();
            sendResponse({ status: "Highlighting stopped" });
        } else if (message.action === 'stop') {
            console.log('Received stop task message');
            shouldStop = true;
            // 不再调用 stopHighlighting(); // 保持高亮显示
            sendResponse({ status: 'stopped' });
        }
    } catch (error) {
        console.error('处理高亮消息时出错:', error);
        try {
            sendResponse({ status: 'error', message: error.message });
        } catch (e) {
            // 忽略二次错误
        }
    }
    // 不返回 true，避免异步响应错误
});

// --- 脚本加载时自动检查是否需要高亮 ---
try {
    chrome.storage.local.get(['isRunning', 'previewAccounts'], (result) => {
        if (!chrome.runtime.lastError && result.previewAccounts && result.previewAccounts.length > 0) {
             console.log('Detected existing preview accounts. Auto-starting highlighting.');
             setupPersistentHighlighting();
        }
        // 移除了在任务运行时停止高亮的逻辑
    });
} catch (error) {
    console.error("Error during initial highlighting check:", error);
}

// --- 结束新增代码 ---

// Make functions available globally for popup.js to call
window.getFollowingList = getFollowingList;
window.unfollowSelectedAccounts = unfollowSelectedAccounts;