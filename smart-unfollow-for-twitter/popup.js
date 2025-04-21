document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const previewButton = document.getElementById('previewButton');
  const status = document.getElementById('status');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const totalAccounts = document.getElementById('totalAccounts');
  const unfollowedCount = document.getElementById('unfollowedCount');
  const timeElapsed = document.getElementById('timeElapsed');
  const warning = document.getElementById('warning');
  const accountsListContainer = document.getElementById('accountsListContainer');
  const accountsList = document.getElementById('accountsList');
  const confirmUnfollowBtn = document.getElementById('confirmUnfollowBtn');
  const scrollToBottomLink = document.getElementById('scrollToBottomLink');
  
  let startTime;
  let updateTimer;
  let syncTimer;
  let isFirstSync = true;
  let isPreviewMode = false;
  let previewAccounts = []; // 保存预览的账号列表
  let keepList = new Set(); // 保存标记为保留的账号用户名
  let dataLoadAttempted = false; // 新增：标记是否已尝试加载数据

  // 加载保留账号列表
  function loadKeepList() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['keepList'], (result) => {
        if (result.keepList && Array.isArray(result.keepList)) {
          keepList = new Set(result.keepList);
          console.log('已加载保留列表:', keepList);
        } else {
          keepList = new Set();
        }
        resolve(keepList);
      });
    });
  }
  
  // 保存保留账号列表
  function saveKeepList() {
    const keepArray = Array.from(keepList);
    return chrome.storage.local.set({ keepList: keepArray })
      .then(() => {
        console.log('保留列表已保存:', keepArray);
        return keepArray;
      });
  }
  
  // 加载预览账号列表
  function loadPreviewAccounts() {
    return new Promise((resolve) => {
      // 显示加载状态
      status.textContent = '加载保存的数据中...';
      
      chrome.storage.local.get(['previewAccounts'], (result) => {
        if (result.previewAccounts && Array.isArray(result.previewAccounts)) {
          previewAccounts = result.previewAccounts;
          console.log('已加载预览账号列表:', previewAccounts.length, '个账号');
        } else {
          previewAccounts = [];
          console.log('未找到保存的预览账号列表');
        }
        resolve(previewAccounts);
      });
    });
  }
  
  // 保存预览账号列表
  function savePreviewAccounts() {
    return chrome.storage.local.set({ previewAccounts: previewAccounts })
      .then(() => {
        console.log('预览账号列表已保存:', previewAccounts.length, '个账号');
        return previewAccounts;
      });
  }
  
  // 更新账号是否保留的状态并自动保存
  function updateAccountKeepStatus(username, keep) {
    if (keep) {
      keepList.add(username);
    } else {
      keepList.delete(username);
    }
    
    // 自动保存列表
    saveKeepList().then(() => {
      console.log(`账号 @${username} 保留状态已更新并保存`);
      
      // 如果预览账号列表存在，同时更新预览账号列表中相应账号的状态
      if (previewAccounts && previewAccounts.length > 0) {
        // 更新后的预览账号也需要保存
        savePreviewAccounts();
      }
    }).catch(error => {
      console.error('保存保留列表出错:', error);
    });
  }

  function syncProgress() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return;
      
      // First check storage
      chrome.storage.local.get(['isRunning', 'progress'], (result) => {
        // 暂存从存储中读取的状态
        const storedIsRunning = result.isRunning;
        const storedProgress = result.progress;

        if (storedIsRunning && storedProgress) {
          updateUI(storedProgress);
        }
        
        // Then try to get live updates
        chrome.tabs.sendMessage(tab.id, { action: 'getProgress' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Connection failed:', chrome.runtime.lastError);
            
            // --- 关键修改点 ---
            // 连接失败，说明 content script 可能已失效 (页面刷新等)
            // 此时，优先检查存储中的 *完成状态*
            chrome.storage.local.get(['progress'], (finalCheckResult) => {
              if (finalCheckResult.progress && finalCheckResult.progress.completed) {
                // 如果存储记录显示任务已完成，则强制重置UI
                console.log('连接失败，但检测到存储中任务已完成，重置UI');
                chrome.storage.local.set({ isRunning: false }); // 确保 isRunning 也被重置
                resetUI();
              } else if (storedIsRunning && storedProgress) {
                // 如果任务未标记完成，再检查上次更新时间（之前的逻辑）
                const currentTime = Date.now();
                const lastUpdateTime = storedProgress.lastUpdateTime || 0;
                if (currentTime - lastUpdateTime > 30000) {
                  console.log('任务超过30秒无响应，自动重置状态');
                  chrome.storage.local.set({ isRunning: false, progress: null });
                  resetUI();
                } else {
                  // 仍然认为在运行，但无法获取实时更新，显示存储的状态
                  updateUI(storedProgress);
                }
              } else if (isFirstSync) {
                 // 如果是首次同步且无运行状态，则重置
                 resetUI();
              }
            });
            // --- 修改结束 ---

            return;
          }

          isFirstSync = false;
          if (response && response.type === 'progress') {
            updateUI(response);
            // 更新最后活动时间
            response.lastUpdateTime = Date.now();
            // Save the latest progress
            chrome.storage.local.set({
              isRunning: true,
              progress: response
            });
          }
        });
      });
    });
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'previewProgress') {
      updatePreviewProgress(message.found, message.total);
    }
    return true;
  });

  // Update preview progress
  function updatePreviewProgress(found, total) {
    if (isPreviewMode) {
      status.textContent = `获取中... 已找到 ${found} 个账号`;
      
      // 更新进度条
      if (total > 0) {
        const progressPercent = (found / total) * 100;
        progressFill.style.width = `${progressPercent}%`;
      }
      
      // 更新红框区域的统计信息
      totalAccounts.textContent = found;
      
      // 设置时间计数器（如果尚未设置）
      if (!startTime) {
        startTime = Date.now();
        if (!updateTimer) {
          updateTimer = setInterval(updateElapsedTime, 1000);
        }
      }
    }
  }
  
  // Display a loading spinner in the accounts list
  function showLoadingSpinner() {
    if (!accountsList) {
      console.error('账号列表元素不存在');
      return;
    }
    accountsList.innerHTML = '<div class="loading-spinner"></div>';
  }
  
  // Display accounts in the list
  async function displayAccountsList(accounts) {
    // 确保accountsList元素存在
    if (!accountsList) {
      console.error('账号列表容器元素不存在');
      return;
    }
    
    accountsList.innerHTML = '';
    
    if (!accounts || accounts.length === 0) {
      accountsList.innerHTML = '<div class="account-item">未找到任何关注账号</div>';
      return;
    }
    
    console.log('显示账号列表:', accounts);
    
    // 保存预览的账号列表，用于后续取消关注
    previewAccounts = accounts;
    
    // 持久化保存预览账号列表
    await savePreviewAccounts();
    
    // **新增：通知 content script 开始高亮**
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'startHighlighting' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("无法发送 startHighlighting 消息:", chrome.runtime.lastError.message);
                } else {
                    console.log("Start highlighting message sent, response:", response);
                }
            });
        }
    });

    // 加载保留列表
    await loadKeepList();
    
    // 处理账号数量限制
    const keptAccounts = accounts.filter(acc => keepList.has(acc.username));
    let nonKeptAccounts = accounts.filter(acc => !keepList.has(acc.username));
    
    // 如果未标记保留的账号超过100个，只保留前100个
    if (nonKeptAccounts.length > 100) {
      console.log(`未标记保留的账号数量(${nonKeptAccounts.length})超过100个，裁剪到100个`);
      nonKeptAccounts = nonKeptAccounts.slice(0, 100);
      
      // 更新预览账号列表
      previewAccounts = [...keptAccounts, ...nonKeptAccounts];
      // 持久化保存更新后的预览账号列表
      savePreviewAccounts();
    }
    
    // 计算统计数据
    const keptAccountsCount = keptAccounts.length;
    const unkeptAccountsCount = nonKeptAccounts.length;
    const totalAccountsCount = keptAccountsCount + unkeptAccountsCount;
    
    // 更新统计显示 - 确保DOM元素存在
    const totalFoundElement = document.getElementById('totalFoundAccounts');
    const keptAccountsElement = document.getElementById('keptAccounts');
    const unkeptAccountsElement = document.getElementById('unkeptAccounts');
    
    if (totalFoundElement) totalFoundElement.textContent = totalAccountsCount;
    if (keptAccountsElement) keptAccountsElement.textContent = keptAccountsCount;
    if (unkeptAccountsElement) unkeptAccountsElement.textContent = unkeptAccountsCount;
    
    // 合并两个列表进行显示
    const displayAccounts = [...nonKeptAccounts, ...keptAccounts];
    
    displayAccounts.forEach(account => {
      // 检查账号数据有效性
      if (!account || !account.displayName) {
        console.log('无效账号数据:', account);
        return;
      }
      
      const isKept = keepList.has(account.username);
      
      const accountItem = document.createElement('div');
      accountItem.className = 'account-item';
      if (isKept) {
        accountItem.classList.add('kept');
      }
      accountItem.dataset.username = account.username;
      
      const accountInfo = document.createElement('div');
      accountInfo.className = 'account-info';
      
      const accountName = document.createElement('div');
      accountName.className = 'account-name';
      accountName.textContent = account.displayName;
      
      const accountUsername = document.createElement('div');
      accountUsername.className = 'account-username';
      
      // 创建链接替代纯文本
      const usernameLink = document.createElement('a');
      usernameLink.href = `https://x.com/${account.username}`;
      usernameLink.textContent = '@' + account.username;
      
      // 为账号信息区域添加点击事件
      const openProfile = (e) => {
        // 如果是复选框的点击，不处理
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') {
          return;
        }
        
        e.preventDefault(); // 阻止默认行为
        const url = `https://x.com/${account.username}`;
        
        // 查找是否有已打开的X.com标签页
        chrome.tabs.query({}, (tabs) => {
          const xTabs = tabs.filter(tab => 
            tab.url && (tab.url.includes('twitter.com') || tab.url.includes('x.com'))
          );
          
          if (xTabs.length > 0) {
            // 如果找到了X.com的标签页，在第一个找到的标签页中打开
            chrome.tabs.update(xTabs[0].id, { url: url });
          } else {
            // 如果没有找到X.com的标签页，创建一个新标签页
            chrome.tabs.create({ url: url });
          }
        });
      };
      
      // 将点击事件添加到整个账号信息区域
      accountInfo.style.cursor = 'pointer'; // 添加指针样式
      accountInfo.addEventListener('click', openProfile);
      
      // 为用户名链接也添加相同的点击事件处理（替代原有逻辑）
      usernameLink.addEventListener('click', openProfile);
      
      accountUsername.appendChild(usernameLink);
      
      accountInfo.appendChild(accountName);
      accountInfo.appendChild(accountUsername);
      accountItem.appendChild(accountInfo);
      
      // 添加保留复选框
      const keepCheckboxContainer = document.createElement('div');
      keepCheckboxContainer.className = 'keep-checkbox';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `keep-${account.username}`;
      checkbox.checked = isKept;
      checkbox.addEventListener('change', (e) => {
        updateAccountKeepStatus(account.username, e.target.checked);
        
        // 更新UI样式
        if (e.target.checked) {
          accountItem.classList.add('kept');
        } else {
          accountItem.classList.remove('kept');
        }
        
        // 更新统计 - 安全地更新DOM
        try {
          const keptElements = document.querySelectorAll('.account-item.kept');
          const keptCount = keptElements ? keptElements.length : 0;
          const totalCount = displayAccounts.length;
          const unkeptCount = totalCount - keptCount;
          
          if (keptAccountsElement) keptAccountsElement.textContent = keptCount;
          if (unkeptAccountsElement) unkeptAccountsElement.textContent = unkeptCount;
          
          // 更新开始按钮的状态 - 如果有未标记保留的账号，则启用按钮
          if (startButton) {
            startButton.disabled = unkeptCount === 0;
            console.log(`更新按钮状态: ${unkeptCount}个未标记保留账号, 按钮${unkeptCount === 0 ? '禁用' : '启用'}`);
          }
        } catch (error) {
          console.error('更新统计数据时出错:', error);
        }
      });
      
      const label = document.createElement('label');
      label.htmlFor = `keep-${account.username}`;
      label.textContent = '保留';
      
      keepCheckboxContainer.appendChild(checkbox);
      keepCheckboxContainer.appendChild(label);
      accountItem.appendChild(keepCheckboxContainer);
      
      accountsList.appendChild(accountItem);
    });
    
    // 检查是否有待取消关注的账号，以决定启用还是禁用开始按钮
    if (startButton) {
      startButton.disabled = unkeptAccountsCount === 0;
    }
  }

  function updateUI(progress) {
    if (!progress) return;
    
    startButton.style.display = 'none';
    stopButton.style.display = 'block';
    progressContainer.style.display = 'block';
    
    // Only update counts if they're higher than current values
    const currentTotal = parseInt(totalAccounts.textContent) || 0;
    const currentUnfollowed = parseInt(unfollowedCount.textContent) || 0;
    
    if (progress.totalFound > currentTotal) {
      totalAccounts.textContent = progress.totalFound;
    }
    if (progress.unfollowed > currentUnfollowed) {
      unfollowedCount.textContent = progress.unfollowed;
    }
    
    status.textContent = progress.status || 'Running...';
    warning.style.display = progress.rateLimited ? 'block' : 'none';
    
    if (progress.totalFound > 0) {
      const progressPercent = (progress.unfollowed / progress.totalFound) * 100;
      progressFill.style.width = `${progressPercent}%`;
    }

    if (progress.completed) {
      setTimeout(resetUI, 5000);
    }
  }

  // 新增函数：初始化数据加载
  async function initializeDataLoading() {
    if (dataLoadAttempted) return; // 防止重复加载
    dataLoadAttempted = true;
    
    console.log('正在初始化数据加载...');
    
    try {
      // 显示加载状态
      status.textContent = '正在加载数据...';
      
      // 先加载保留列表
      await loadKeepList();
      
      // 然后加载预览账号列表
      const accounts = await loadPreviewAccounts();
      
      // 如果存在保存的预览账号列表，显示它们
      if (accounts && accounts.length > 0) {
        console.log(`找到${accounts.length}个保存的账号，正在显示...`);
        
        // 按照未保留的优先显示
        const keptAccounts = accounts.filter(acc => keepList.has(acc.username));
        const nonKeptAccounts = accounts.filter(acc => !keepList.has(acc.username));
        
        // 重新排序账号列表，将未标记保留的账号显示在前面
        previewAccounts = [...nonKeptAccounts, ...keptAccounts];
        
        // 强制显示账号列表容器
        if (accountsListContainer) {
          accountsListContainer.style.display = 'block';
        }
        
        // 显示账号列表
        await displayAccountsList(previewAccounts);
        
        // 更新状态信息
        status.textContent = `已加载 ${accounts.length} 个账号 (${nonKeptAccounts.length} 个待取消关注, ${keptAccounts.length} 个已标记保留)`;
        
        // 如果有待取消关注的账号，启用开始按钮
        if (startButton) {
          startButton.disabled = nonKeptAccounts.length === 0;
        }
      } else {
        console.log('未找到保存的账号数据');
        status.textContent = '点击按钮开始...';
      }
    } catch (error) {
      console.error('初始化数据加载错误:', error);
      status.textContent = '数据加载出错，请重试';
    }
  }

  // 修改现有的加载保存状态的逻辑
  chrome.storage.local.get(['isRunning', 'progress'], (result) => {
    if (result.isRunning) {
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
      progressContainer.style.display = 'block';
      
      if (result.progress) {
        totalAccounts.textContent = result.progress.totalFound || '0';
        unfollowedCount.textContent = result.progress.unfollowed || '0';
        status.textContent = result.progress.status || 'Running...';
        warning.style.display = result.progress.rateLimited ? 'block' : 'none';
        
        if (result.progress.totalFound > 0) {
          const progress = (result.progress.unfollowed / result.progress.totalFound) * 100;
          progressFill.style.width = `${progress}%`;
        }
        
        startTime = result.progress.startTime || Date.now();
        updateTimer = setInterval(updateElapsedTime, 1000);
      }
      
      // Start syncing progress
      syncTimer = setInterval(syncProgress, 1000);
      // Immediate first sync
      syncProgress();
    } else {
      // 如果没有正在运行的取消关注流程，调用新的初始化函数
      // 使用setTimeout确保DOM已完全加载
      setTimeout(initializeDataLoading, 100);
    }
  });

  function updateElapsedTime() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    timeElapsed.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function resetUI() {
    startButton.style.display = 'block';
    previewButton.style.display = 'block';
    stopButton.style.display = 'none';
    startButton.disabled = false;
    previewButton.disabled = false;
    status.textContent = '点击按钮开始...';
    progressContainer.style.display = 'none';
    progressFill.style.width = '0%';
    totalAccounts.textContent = '0';
    unfollowedCount.textContent = '0';
    timeElapsed.textContent = '0:00';
    warning.style.display = 'none';
    accountsListContainer.style.display = 'none';
    isPreviewMode = false;
    if (updateTimer) clearInterval(updateTimer);
    if (syncTimer) clearInterval(syncTimer);
    chrome.storage.local.remove(['isRunning', 'progress']);
    
    // 添加重置预览账号列表变量，但不从存储中删除
    previewAccounts = [];
    
    // **新增：通知 content script 停止高亮**
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'stopHighlighting' }, (response) => {
                 if (chrome.runtime.lastError) {
                    console.log("无法发送 stopHighlighting 消息:", chrome.runtime.lastError.message);
                } else {
                    console.log("Stop highlighting message sent, response:", response);
                }
            });
        }
    });

    // 显示操作按钮但不清空保留列表
    confirmUnfollowBtn.style.display = 'none';
  }

  function isValidTwitterUrl(url) {
    try {
      const urlObj = new URL(url);
      const isTwitterDomain = urlObj.hostname === 'twitter.com' || 
                            urlObj.hostname === 'x.com' || 
                            urlObj.hostname === 'www.twitter.com' || 
                            urlObj.hostname === 'www.x.com';
      
      if (!isTwitterDomain) return false;
      
      const pathParts = urlObj.pathname.split('/').filter(part => part);
      // Valid if we have a username and optionally /following
      return pathParts.length >= 1 && 
             (pathParts.length === 1 || 
              (pathParts.length === 2 && pathParts[1] === 'following'));
    } catch {
      return false;
    }
  }

  stopButton.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id) { // Check if tab exists
        // 发送停止任务消息
        chrome.tabs.sendMessage(tab.id, { action: 'stop' }, (response) => {
             if (chrome.runtime.lastError) {
                console.log("无法发送 stop 消息:", chrome.runtime.lastError.message);
            } else {
                console.log("Stop message sent, response:", response);
            }
            // **也发送停止高亮消息** (因为 resetUI 会在 stop 后调用)
            // resetUI(); // ResetUI 会发送 stopHighlighting 消息，所以这里可能不需要重复发送
        });
      }
      // 无论消息是否成功发送，都重置UI
      resetUI(); 
    });
  });

  // 预览按钮点击事件
  previewButton.addEventListener('click', () => {
    isPreviewMode = true;
    startButton.style.display = 'block';
    startButton.disabled = true;
    previewButton.disabled = true;
    status.textContent = '获取关注列表中...';
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    
    // 初始化红框区域的统计数据
    totalAccounts.textContent = '0';
    unfollowedCount.textContent = '0';
    
    // 初始化计时器
    startTime = Date.now();
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(updateElapsedTime, 1000);
    
    // 先清空并重置列表容器
    accountsListContainer.style.display = 'block';
    showLoadingSpinner();
    
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab.url || !isValidTwitterUrl(tab.url)) {
        status.textContent = '请导航到Twitter/X个人资料或关注页面!';
        resetUI();
        return;
      }

      try {
        // 首先加载保留列表
        await loadKeepList();
        
        // 注入脚本
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['unfollow.js']
        });

        // 执行获取列表函数，传入保留列表
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (keepListArray) => {
            if (typeof getFollowingList === 'function') {
              // 捕获执行过程中的日志
              const originalConsoleLog = console.log;
              const logs = [];
              console.log = (...args) => {
                logs.push(args.join(' '));
                originalConsoleLog.apply(console, args);
              };
              
              try {
                // 设定真正要找的未标记保留的账号数量为100个
                const targetUnkeptAccounts = 100;
                // 将数组转换为Set以便快速查找
                const keepSet = new Set(keepListArray);
                
                // 调用获取列表函数，多找一些账号以应对保留账号的情况
                const promise = getFollowingList(targetUnkeptAccounts, keepSet); 
                return promise.then(result => {
                  console.log = originalConsoleLog;
                  return { 
                    accounts: result,
                    logs: logs
                  };
                });
              } catch (error) {
                console.log = originalConsoleLog;
                throw error;
              }
            } else {
              throw new Error('getFollowingList function not found!');
            }
          },
          args: [Array.from(keepList)]
        });

        // 隐藏进度条显示
        progressContainer.style.display = 'none';
        
        // 处理结果
        if (results && results[0] && results[0].result) {
          const resultData = results[0].result;
          const accounts = resultData.accounts;
          console.log('获取到的数据:', resultData);
          
          if (accounts && accounts.length > 0) {
            // 处理账号列表，确保未标记保留的账号不超过100个
            const keptAccounts = accounts.filter(acc => keepList.has(acc.username));
            let nonKeptAccounts = accounts.filter(acc => !keepList.has(acc.username));
            
            // 如果未标记保留的账号超过100个，只保留前100个
            if (nonKeptAccounts.length > 100) {
              console.log(`未标记保留的账号数量(${nonKeptAccounts.length})超过100个，裁剪到100个`);
              nonKeptAccounts = nonKeptAccounts.slice(0, 100);
              
              // 更新accounts列表
              const displayAccounts = [...nonKeptAccounts, ...keptAccounts];
              
              // 更新状态文本，使用实际显示的账号数量
              status.textContent = `已找到 ${displayAccounts.length} 个账号 (${nonKeptAccounts.length} 个待取消关注, ${keptAccounts.length} 个已标记保留)`;
              
              // 确保DOM元素存在
              if (accountsListContainer && accountsList) {
                accountsListContainer.style.display = 'block';
                await displayAccountsList(displayAccounts);
                
                // 如果有待取消关注的账号，启用开始按钮
                startButton.disabled = nonKeptAccounts.length === 0;
              } else {
                status.textContent = '显示账号列表时出错，请刷新重试';
                console.error('账号列表容器元素未找到');
              }
            } else {
              // 原始账号数量没有超过限制
              status.textContent = `已找到 ${accounts.length} 个账号 (${nonKeptAccounts.length} 个待取消关注, ${keptAccounts.length} 个已标记保留)`;
              
              // 确保DOM元素存在
              if (accountsListContainer && accountsList) {
                accountsListContainer.style.display = 'block';
                await displayAccountsList(accounts);
                
                // 如果有待取消关注的账号，启用开始按钮
                startButton.disabled = nonKeptAccounts.length === 0;
              } else {
                status.textContent = '显示账号列表时出错，请刷新重试';
                console.error('账号列表容器元素未找到');
              }
            }
          } else {
            status.textContent = '未找到关注账号';
            accountsList.innerHTML = '<div class="account-item">未能找到任何关注账号</div>';
            console.log('调试日志:', resultData.logs);
            startButton.disabled = true;
          }
        } else {
          status.textContent = '未找到关注账号或发生错误';
          accountsList.innerHTML = '<div class="account-item">无法加载关注列表</div>';
          startButton.disabled = true;
        }

        // 恢复UI状态
        previewButton.disabled = false;
      } catch (error) {
        // 处理错误
        console.error('脚本执行错误:', error);
        status.textContent = '获取关注列表失败，请刷新页面重试';
        if (accountsList) {
          accountsList.innerHTML = '<div class="account-item">发生错误: ' + error.message + '</div>';
        }
        previewButton.disabled = false;
        startButton.disabled = true;
        progressContainer.style.display = 'none';
      }
    });
  });

  // 添加确认取消关注按钮事件
  confirmUnfollowBtn.addEventListener('click', async () => {
    // 筛选出未标记为保留的账号
    let nonKeptAccounts = previewAccounts.filter(account => !keepList.has(account.username));
    const keptAccounts = previewAccounts.filter(account => keepList.has(account.username));
    
    // 如果未标记保留的账号超过100个，只使用前100个
    if (nonKeptAccounts.length > 100) {
      console.log(`未标记保留的账号数量(${nonKeptAccounts.length})超过100个，裁剪到100个`);
      nonKeptAccounts = nonKeptAccounts.slice(0, 100);
    }
    
    const accountsToUnfollow = nonKeptAccounts;
    
    if (accountsToUnfollow.length === 0) {
      status.textContent = '没有选择要取消关注的账号';
      return;
    }
    
    confirmUnfollowBtn.disabled = true;
    startButton.style.display = 'none';
    previewButton.style.display = 'none';
    stopButton.style.display = 'block';
    accountsListContainer.style.display = 'none';
    progressContainer.style.display = 'block';
    startTime = Date.now();
    updateTimer = setInterval(updateElapsedTime, 1000);
    isFirstSync = true;
    
    status.textContent = `开始取消关注 ${accountsToUnfollow.length} 个账号...`;
    
    // 保存要取消关注的账号列表和进度信息
    chrome.storage.local.set({
      isRunning: true,
      progress: {
        startTime: startTime,
        status: '开始执行...',
        totalFound: accountsToUnfollow.length,
        unfollowed: 0
      },
      unfollowList: accountsToUnfollow
    });
    
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab.url || !isValidTwitterUrl(tab.url)) {
        status.textContent = '请导航到Twitter/X个人资料或关注页面!';
        resetUI();
        return;
      }
      
      try {
        // 注入脚本
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['unfollow.js']
        });
        
        // 执行取消关注函数
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (unfollowList) => {
            if (typeof unfollowSelectedAccounts === 'function') {
              unfollowSelectedAccounts(unfollowList);
            } else {
              throw new Error('unfollowSelectedAccounts function not found!');
            }
          },
          args: [accountsToUnfollow]
        });
        
        // 开始同步进度
        syncTimer = setInterval(syncProgress, 1000);
        // 立即进行第一次同步
        syncProgress();
      } catch (error) {
        console.error('脚本注入错误:', error);
        status.textContent = '启动取消关注过程出错。请刷新页面重试。';
        resetUI();
      }
    });
  });

  // 开始取消关注按钮点击事件
  startButton.addEventListener('click', async () => {
    // 检查是否已经有预览的账号列表
    if (!previewAccounts || previewAccounts.length === 0) {
      // 如果没有预览列表，先获取预览
      previewButton.click();
      return;
    }
    
    // 筛选出未标记为保留的账号
    let nonKeptAccounts = previewAccounts.filter(account => !keepList.has(account.username));
    const keptAccounts = previewAccounts.filter(account => keepList.has(account.username));
    
    // 如果未标记保留的账号超过100个，只使用前100个
    if (nonKeptAccounts.length > 100) {
      console.log(`未标记保留的账号数量(${nonKeptAccounts.length})超过100个，裁剪到100个`);
      nonKeptAccounts = nonKeptAccounts.slice(0, 100);
    }
    
    const accountsToUnfollow = nonKeptAccounts;
    
    if (accountsToUnfollow.length === 0) {
      status.textContent = '没有选择要取消关注的账号';
      return;
    }
    
    console.log(`准备取消关注 ${accountsToUnfollow.length} 个账号:`, accountsToUnfollow);
    
    startButton.disabled = true;
    previewButton.disabled = true;
    startButton.style.display = 'none';
    previewButton.style.display = 'none';
    stopButton.style.display = 'block';
    accountsListContainer.style.display = 'none';
    progressContainer.style.display = 'block';
    startTime = Date.now();
    updateTimer = setInterval(updateElapsedTime, 1000);
    isFirstSync = true;
    
    status.textContent = `开始取消关注 ${accountsToUnfollow.length} 个账号...`;
    
    // 保存要取消关注的账号列表和进度信息 - 确保首先清除旧的任务状态
    chrome.storage.local.remove(['unfollowTask'], () => {
      chrome.storage.local.set({
        isRunning: true,
        progress: {
          startTime: startTime,
          status: '开始执行...',
          totalFound: accountsToUnfollow.length,
          unfollowed: 0
        },
        unfollowList: accountsToUnfollow
      }, () => {
        console.log('取消关注任务数据已保存到存储');
      });
    });
    
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab.url || !isValidTwitterUrl(tab.url)) {
        status.textContent = '请导航到Twitter/X个人资料或关注页面!';
        resetUI();
        return;
      }
      
      try {
        // 确保清除旧的数据
        await chrome.storage.local.remove(['unfollowTask']);
        
        // 注入脚本
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['unfollow.js']
        });
        
        console.log('正在执行取消关注函数...');
        
        // 执行取消关注函数
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (unfollowList) => {
            console.log(`在内容脚本中收到 ${unfollowList.length} 个要取消关注的账号`);
            if (typeof unfollowSelectedAccounts === 'function') {
              unfollowSelectedAccounts(unfollowList);
              return true;
            } else {
              throw new Error('unfollowSelectedAccounts function not found!');
            }
          },
          args: [accountsToUnfollow]
        });
        
        console.log('取消关注任务已启动，开始同步进度');
        
        // 开始同步进度
        syncTimer = setInterval(syncProgress, 1000);
        // 立即进行第一次同步
        syncProgress();
      } catch (error) {
        console.error('脚本注入错误:', error);
        status.textContent = '启动取消关注过程出错。请刷新页面重试。';
        resetUI();
      }
    });
  });

  // 添加滚动到底部链接的点击事件处理
  scrollToBottomLink.addEventListener('click', (e) => {
    e.preventDefault();
    
    // 显示正在处理的状态
    const originalText = scrollToBottomLink.textContent;
    scrollToBottomLink.textContent = '正在滚动...';
    scrollToBottomLink.style.pointerEvents = 'none';
    scrollToBottomLink.style.opacity = '0.7';
    status.textContent = '正在执行滚动到底部操作...';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        scrollToBottomLink.textContent = originalText;
        scrollToBottomLink.style.pointerEvents = 'auto';
        scrollToBottomLink.style.opacity = '1';
        status.textContent = '无法获取当前标签页';
        return;
      }
      
      // 注入内容脚本
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js']
      })
      .then(() => {
        // 向内容脚本发送滚动到底部的消息
        chrome.tabs.sendMessage(tab.id, { action: 'scrollToBottom' }, (response) => {
          // 处理返回结果或错误
          if (chrome.runtime.lastError) {
            console.error('发送消息错误:', chrome.runtime.lastError);
            status.textContent = '滚动操作失败: ' + chrome.runtime.lastError.message;
          } else if (response && response.status === 'success') {
            status.textContent = '滚动到底部操作完成';
          } else {
            status.textContent = response ? response.message : '滚动操作未返回有效结果';
          }
          
          // 恢复链接原始状态
          scrollToBottomLink.textContent = originalText;
          scrollToBottomLink.style.pointerEvents = 'auto';
          scrollToBottomLink.style.opacity = '1';
        });
      })
      .catch(error => {
        console.error('注入脚本错误:', error);
        status.textContent = '滚动操作失败: 无法注入脚本';
        scrollToBottomLink.textContent = originalText;
        scrollToBottomLink.style.pointerEvents = 'auto';
        scrollToBottomLink.style.opacity = '1';
      });
    });
  });

  // 确保页面可见性改变时重新尝试加载数据
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !dataLoadAttempted) {
      console.log('页面变为可见，尝试加载数据');
      initializeDataLoading();
    }
  });
  
  // 确保popup窗口完全显示后尝试加载数据
  window.addEventListener('load', () => {
    console.log('窗口完全加载，确保数据初始化');
    setTimeout(initializeDataLoading, 200);
  });

  // 初始化时加载保留列表
  loadKeepList();
  
  // 初始化状态文本
  status.textContent = '准备中...';
});