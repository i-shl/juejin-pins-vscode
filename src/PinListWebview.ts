import * as vscode from 'vscode';
import { Pin, Comment, Reply, fetchPins, fetchComments, fetchReplies } from './api';
import { PinDetailPanel } from './PinDetailPanel';

interface ListPin {
  id: string;
  avatar: string;
  author: string;
  job: string;
  time: string;
  content: string;
  pics: string[];
  likes: number;
  comments: number;
}

interface ListReply {
  author: string;
  avatar: string;
  content: string;
  likes: number;
  replyTo: string;
}

interface ListComment {
  id: string;
  author: string;
  avatar: string;
  content: string;
  likes: number;
  replies: ListReply[];
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class PinListWebview {
  private _view?: vscode.Webview;
  private currentTab: 'new' | 'hot' = 'new';
  private pins: Pin[] = [];
  private cursor: string = '0';
  private hasMore: boolean = false;
  private loading: boolean = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  attach(webview: vscode.Webview): void {
    this._view = webview;
    webview.options = { enableScripts: true };
    webview.html = this.getHtml();

    webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          this.loadPins(false);
          break;
        case 'switchTab':
          this.switchTab(msg.tab);
          break;
        case 'loadMore':
          this.loadMore();
          break;
        case 'openDetail':
          this.openDetail(msg.id);
          break;
        case 'refresh':
          this.loadPins(false);
          break;
        case 'loadComments':
          this.loadCommentsForPin(msg.id, msg.sort);
          break;
        case 'loadMoreComments':
          this.loadMoreCommentsForPin(msg.id, msg.sort, msg.cursor);
          break;
      }
    });
  }

  detach(): void {
    this._view = undefined;
  }

  private switchTab(tab: 'new' | 'hot'): void {
    if (tab === this.currentTab) return;
    this.currentTab = tab;
    this.pins = [];
    this.cursor = '0';
    this.hasMore = false;
    this.loadPins(false);
  }

  private loadMore(): void {
    if (this.loading || !this.hasMore) return;
    this.loadPins(true);
  }

  private async loadPins(append: boolean): Promise<void> {
    if (!this._view) return;
    this.loading = true;
    if (append) {
      this.post({ type: 'loadingMore', loading: true });
    } else {
      this.post({ type: 'loading' });
    }

    try {
      const res = await fetchPins(this.currentTab, this.cursor);
      if (res.err_no === 0) {
        if (append) this.pins.push(...res.data);
        else this.pins = res.data;
        this.cursor = res.cursor;
        this.hasMore = res.has_more;
      } else {
        vscode.window.showErrorMessage(`API错误: ${res.err_msg}`);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`网络请求失败: ${e}`);
    }

    this.loading = false;
    this.post({ type: append ? 'loadingMore' : 'list', loading: false, tab: this.currentTab, pins: this.mapPins(), hasMore: this.hasMore });
  }

  private mapPins(): ListPin[] {
    return this.pins.map((pin) => ({
      id: pin.msg_id,
      avatar: pin.author_user_info?.avatar_large || '',
      author: pin.author_user_info?.user_name || '匿名',
      job: pin.author_user_info?.job_title || '',
      time: formatTime(Number(pin.msg_Info?.ctime) || 0),
      content: pin.msg_Info?.content || '',
      pics: (pin.msg_Info?.pic_list || []).map((p: any) =>
        typeof p === 'string' ? p : (p?.url || p?.pic_url || '')
      ).filter(Boolean),
      likes: pin.msg_Info?.digg_count || 0,
      comments: pin.msg_Info?.comment_count || 0,
    }));
  }

  private mapComments(comments: Comment[]): ListComment[] {
    return comments.map((c) => ({
      id: c.comment_id,
      author: c.user_info?.user_name || '匿名',
      avatar: c.user_info?.avatar_large || '',
      content: c.comment_info?.comment_content || '',
      likes: c.comment_info?.digg_count || 0,
      replies: (c.reply_infos || []).map((r): ListReply => ({
        author: r.user_info?.user_name || '匿名',
        avatar: r.user_info?.avatar_large || '',
        content: r.reply_info?.reply_content || '',
        likes: r.reply_info?.digg_count || 0,
        replyTo: r.reply_user?.user_name || '',
      })),
    }));
  }

  private async loadCommentsForPin(pinId: string, sort: number): Promise<void> {
    const pin = this.pins.find((p) => p.msg_id === pinId);
    if (!pin || !this._view) return;
    try {
      // 一次性加载所有评论
      let cursor = '0';
      let hasMore = true;
      const all: Comment[] = [];
      while (hasMore) {
        const res = await fetchComments(pin.msg_id, cursor, 50, sort);
        if (res.err_no === 0) {
          all.push(...res.data);
          cursor = res.cursor;
          hasMore = res.has_more;
        } else {
          hasMore = false;
        }
      }
      // 加载回复
      for (const c of all) {
        const replyCount = c.comment_info?.reply_count || 0;
        if (replyCount > (c.reply_infos?.length || 0)) {
          const rr = await fetchReplies(c.comment_id, pin.msg_id);
          if (rr.err_no === 0) c.reply_infos = rr.data;
        }
      }
      this.post({ type: 'comments', id: pinId, comments: this.mapComments(all), hasMore: false, cursor: '0', sort });
    } catch (e) {
      this.post({ type: 'commentsError', id: pinId });
    }
  }

  private async loadMoreCommentsForPin(pinId: string, sort: number, cursor: string): Promise<void> {
    // 已改为一次性加载，此方法不再使用
  }

  private openDetail(msgId: string): void {
    const pin = this.pins.find((p) => p.msg_id === msgId);
    if (pin) PinDetailPanel.createOrShow(pin);
  }

  private post(msg: unknown): void {
    if (this._view) this._view.postMessage(msg);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --border: var(--vscode-widget-border, #333);
    --muted: var(--vscode-descriptionForeground, #999);
    --card-bg: var(--vscode-editorWidget-background, #252526);
    --btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --btn-fg: var(--vscode-button-secondaryForeground, #ccc);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    background: transparent;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  body.no-images img { display: none !important; }

  /* 顶部固定栏 */
  .topbar {
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--border);
    padding: 8px 10px 6px;
  }
  .titlebar { display: flex; align-items: center; gap: 6px; }
  .tabs { display: flex; gap: 3px; }
  .tab {
    padding: 3px 10px;
    border: none; cursor: pointer;
    background: none; color: var(--muted);
    border-radius: 5px; font-size: 12px;
  }
  .tab.active {
    background: var(--btn-bg); color: var(--vscode-buttonForeground, var(--btn-fg));
    font-weight: 600;
  }
  .actions { display: flex; gap: 2px; margin-left: auto; }
  .icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--muted); font-size: 12px; padding: 3px 8px; border-radius: 4px;
  }
  .icon-btn:hover { color: var(--vscode-foreground); }
  .icon-btn.off { opacity: 0.4; }

  /* 列表滚动区 */
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 8px;
  }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%;
    object-fit: cover; background: #333; flex-shrink: 0;
  }
  .who { flex: 1; min-width: 0; }
  .author { font-weight: 600; font-size: 12px; }
  .meta { color: var(--muted); font-size: 10px; margin-top: 1px; }
  .content {
    font-size: 12px; white-space: pre-wrap; word-break: break-word;
    margin-bottom: 8px; line-height: 1.45;
  }
  .pics { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .pic {
    width: 100px; height: 100px;
    object-fit: cover; border-radius: 6px; cursor: zoom-in;
  }
  .meta-row { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 11px; }
  .comment-toggle { cursor: pointer; }
  .comment-toggle:hover { color: var(--vscode-foreground); }
  .btn-detail {
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: transparent; color: var(--vscode-textLink-foreground, var(--btn-fg));
    border-radius: 4px; cursor: pointer; font-size: 11px;
  }

  /* 内联评论区 */
  .comment-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
  }
  .comment-sort-bar { display: flex; gap: 4px; margin-bottom: 6px; }
  .csort {
    padding: 2px 8px;
    border: 1px solid var(--border);
    background: none; color: var(--muted);
    border-radius: 3px; cursor: pointer; font-size: 10px;
  }
  .csort.active { background: var(--btn-bg); color: var(--btn-fg); font-weight: 600; }
  .ic {
    display: flex; align-items: flex-start; gap: 6px;
    padding: 4px 0; font-size: 11px; line-height: 1.4;
  }
  .ic-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .ic-body { flex: 1; min-width: 0; }
  .ic-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .ic-head-left { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
  .ic-author { font-weight: 600; }
  .ic-likes { color: var(--muted); flex-shrink: 0; font-size: 10px; }
  .ic-text { word-break: break-word; margin-top: 1px; }
  /* 回复 */
  .replies { margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 3px; }
  .reply { display: flex; align-items: flex-start; gap: 4px; font-size: 10px; line-height: 1.35; }
  .reply-avatar { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 1px; }
  .reply-body { flex: 1; min-width: 0; }
  .reply-line { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .reply-line-left { display: flex; align-items: baseline; gap: 3px; min-width: 0; }
  .reply-author { font-weight: 600; }
  .reply-to { color: var(--muted); }
  .reply-likes { color: var(--muted); flex-shrink: 0; font-size: 9px; }
  .reply-text { word-break: break-word; margin-top: 1px; }
  .cstatus { text-align: center; color: var(--muted); padding: 6px; font-size: 11px; }
  .status { text-align: center; color: var(--muted); padding: 14px 0; font-size: 12px; }
</style>
</head>
<body>
  <div class="titlebar">
    <div class="tabs">
      <button class="tab active" data-tab="new">最新</button>
      <button class="tab" data-tab="hot">热门</button>
    </div>
    <div class="actions">
      <button class="icon-btn" id="imgToggle" title="显示/隐藏图片">图片</button>
      <button class="icon-btn" id="refresh" title="刷新">刷新</button>
    </div>
  </div>
  <div class="scroll" id="scroll"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const scrollEl = document.getElementById('scroll');
    let hasMore = false;
    let rendered = [];
    let loadingMore = false;
    const commentState = new Map();

    // 图片开关
    let showImages = true;
    document.getElementById('imgToggle').addEventListener('click', function() {
      showImages = !showImages;
      document.body.classList.toggle('no-images', !showImages);
      this.classList.toggle('off', !showImages);
    });

    // Tab 切换
    document.querySelectorAll('.tab').forEach(function(t) {
      t.addEventListener('click', function() {
        if (t.classList.contains('active')) return;
        document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
        t.classList.add('active');
        rendered = [];
        loadingMore = false;
        commentState.clear();
        scrollEl.innerHTML = '<div class="status">加载中...</div>';
        vscode.postMessage({ type: 'switchTab', tab: t.dataset.tab });
      });
    });
    document.getElementById('refresh').addEventListener('click', function() {
      vscode.postMessage({ type: 'refresh' });
    });

    var esc = function(s) {
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    };

    function picsHtml(p) {
      if (!p.pics || !p.pics.length) return '';
      return '<div class="pics">' + p.pics.map(function(u) {
        return '<img class="pic" src="' + esc(u) + '" onerror="this.style.display=\\'none\\'"/>';
      }).join('') + '</div>';
    }

    function commentSectionHtml(pinId) {
      var cs = commentState.get(pinId);
      if (!cs) return '';
      var sortBtns = '<div class="comment-sort-bar">' +
        '<button class="csort' + (cs.sort===0?' active':'') + '" data-id="' + esc(pinId) + '" data-sort="0">最新</button>' +
        '<button class="csort' + (cs.sort===1?' active':'') + '" data-id="' + esc(pinId) + '" data-sort="1">最热</button>' +
        '</div>';
      var items = cs.comments.map(function(c) {
        var repliesHtml = '';
        if (c.replies && c.replies.length) {
          repliesHtml = '<div class="replies">' + c.replies.map(function(r) {
            return '<div class="reply">' +
              (r.avatar ? '<img class="reply-avatar" src="' + esc(r.avatar) + '" onerror="this.style.display=\\'none\\'"/>' : '') +
              '<div class="reply-body">' +
                '<div class="reply-line">' +
                  '<div class="reply-line-left">' +
                    '<span class="reply-author">' + esc(r.author) + '</span>' +
                    (r.replyTo ? '<span class="reply-to">回复 ' + esc(r.replyTo) + '</span>' : '') +
                  '</div>' +
                  '<span class="reply-likes">👍 ' + r.likes + '</span>' +
                '</div>' +
                '<div class="reply-text">' + esc(r.content) + '</div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
        return '<div class="ic">' +
          (c.avatar ? '<img class="ic-avatar" src="' + esc(c.avatar) + '" onerror="this.style.display=\\'none\\'"/>' : '') +
          '<div class="ic-body">' +
            '<div class="ic-head">' +
              '<div class="ic-head-left">' +
                '<span class="ic-author">' + esc(c.author) + '</span>' +
              '</div>' +
              '<span class="ic-likes">👍 ' + c.likes + '</span>' +
            '</div>' +
            '<div class="ic-text">' + esc(c.content) + '</div>' +
            repliesHtml +
          '</div>' +
        '</div>';
      }).join('');
      var footer = '';
      if (cs.loading) {
        footer = '<div class="cstatus">加载中...</div>';
      } else if (cs.comments.length === 0) {
        footer = '<div class="cstatus">暂无评论</div>';
      }
      return '<div class="comment-section">' + sortBtns + items + footer + '</div>';
    }

    function cardHtml(p) {
      var csHtml = commentSectionHtml(p.id);
      return '<div class="card">' +
        '<div class="head">' +
          (p.avatar ? '<img class="avatar" src="' + esc(p.avatar) + '" onerror="this.style.display=\\'none\\'"/>' : '<div class="avatar"></div>') +
          '<div class="who">' +
            '<div class="author">' + esc(p.author) + '</div>' +
            '<div class="meta">' + esc(p.job) + (p.job?' · ':'') + esc(p.time) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="content">' + esc(p.content) + '</div>' +
        picsHtml(p) +
        '<div class="meta-row">' +
          '<span>👍 ' + p.likes + '</span>' +
          '<span class="comment-toggle" data-id="' + esc(p.id) + '">💬 ' + p.comments + '</span>' +
          '<button class="btn-detail" data-id="' + esc(p.id) + '">查看详情</button>' +
        '</div>' +
        csHtml +
      '</div>';
    }

    function footerHtml() {
      if (loadingMore) return '<div class="status">加载中...</div>';
      return hasMore ? '<div class="status">滚动到底自动加载</div>' : '';
    }

    function reRender() {
      var before = scrollEl.scrollTop;
      scrollEl.innerHTML = rendered.map(cardHtml).join('') + footerHtml();
      scrollEl.scrollTop = before;
    }

    window.addEventListener('message', function(e) {
      var msg = e.data;

      if (msg.type === 'list' || (msg.type === 'loadingMore' && msg.loading === false)) {
        hasMore = !!msg.hasMore;
        rendered = msg.pins;
        loadingMore = false;
        reRender();
        return;
      }
      if (msg.type === 'loading') {
        if (rendered.length === 0) scrollEl.innerHTML = '<div class="status">加载中...</div>';
        return;
      }
      if (msg.type === 'loadingMore' && msg.loading === true) {
        scrollEl.innerHTML = rendered.map(cardHtml).join('') + '<div class="status">加载中...</div>';
        return;
      }
      if (msg.type === 'comments') {
        var cs = commentState.get(msg.id);
        if (cs) { cs.comments = msg.comments; cs.hasMore = msg.hasMore; cs.cursor = msg.cursor; cs.loading = false; }
        reRender();
        return;
      }
      if (msg.type === 'moreComments') {
        var cs2 = commentState.get(msg.id);
        if (cs2) { cs2.comments = cs2.comments.concat(msg.comments); cs2.hasMore = msg.hasMore; cs2.cursor = msg.cursor; cs2.loading = false; }
        reRender();
        return;
      }
      if (msg.type === 'commentsError') {
        var cs3 = commentState.get(msg.id);
        if (cs3) cs3.loading = false;
        reRender();
        return;
      }
    });

    // 触底自动加载
    scrollEl.addEventListener('scroll', function() {
      if (!hasMore || loadingMore) return;
      var distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (distance < 80) {
        loadingMore = true;
        scrollEl.innerHTML = rendered.map(cardHtml).join('') + '<div class="status">加载中...</div>';
        vscode.postMessage({ type: 'loadMore' });
      }
    });

    // 点击事件委托
    scrollEl.addEventListener('click', function(e) {
      var detailBtn = e.target.closest('.btn-detail');
      if (detailBtn) { vscode.postMessage({ type: 'openDetail', id: detailBtn.dataset.id }); return; }

      var ct = e.target.closest('.comment-toggle');
      if (ct) {
        var id = ct.dataset.id;
        if (commentState.has(id)) {
          commentState.delete(id);
          reRender();
        } else {
          commentState.set(id, { comments: [], sort: 0, loading: true, hasMore: false, cursor: '0' });
          reRender();
          vscode.postMessage({ type: 'loadComments', id: id, sort: 0 });
        }
        return;
      }

      var sb = e.target.closest('.csort');
      if (sb) {
        var sid = sb.dataset.id;
        var ss = parseInt(sb.dataset.sort);
        var st = commentState.get(sid);
        if (st && st.sort !== ss) {
          st.sort = ss; st.loading = true; st.comments = [];
          reRender();
          vscode.postMessage({ type: 'loadComments', id: sid, sort: ss });
        }
        return;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}