import * as vscode from 'vscode';
import { Pin, Comment, fetchComments, fetchReplies, RepliesResponse } from './api';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class PinDetailPanel {
  public static currentPanel: PinDetailPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private pin: Pin;
  private comments: Comment[] = [];
  private commentSort: number = 0; // 0=最新 1=最热

  private constructor(panel: vscode.WebviewPanel, pin: Pin) {
    this.panel = panel;
    this.pin = pin;
    this.loadComments();

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'sortComments' && msg.sort !== this.commentSort) {
        this.commentSort = msg.sort;
        this.loadComments();
      }
    });

    this.panel.onDidDispose(() => {
      PinDetailPanel.currentPanel = undefined;
    });
  }

  public static createOrShow(pin: Pin): void {
    if (PinDetailPanel.currentPanel) {
      PinDetailPanel.currentPanel.pin = pin;
      PinDetailPanel.currentPanel.loadComments();
      PinDetailPanel.currentPanel.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'pinDetail',
      '沸点详情',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    PinDetailPanel.currentPanel = new PinDetailPanel(panel, pin);
  }

  private async loadComments(): Promise<void> {
    try {
      // Load comments
      let cursor = '0';
      let hasMore = true;
      const allComments: Comment[] = [];

      while (hasMore) {
        const response = await fetchComments(this.pin.msg_id, cursor, 50, this.commentSort);
        if (response.err_no === 0) {
          allComments.push(...response.data);
          cursor = response.cursor;
          hasMore = response.has_more;
        } else {
          hasMore = false;
        }
      }

      // Load replies for each comment
      for (const comment of allComments) {
        const replyCount = comment.comment_info?.reply_count || 0;
        if (replyCount > (comment.reply_infos?.length || 0)) {
          const replyResponse: RepliesResponse = await fetchReplies(
            comment.comment_id,
            this.pin.msg_id
          );
          if (replyResponse.err_no === 0) {
            comment.reply_infos = replyResponse.data;
          }
        }
      }

      this.comments = allComments;
      this.updateContent();
    } catch (error) {
      console.error('Failed to load comments:', error);
    }
  }

  private updateContent(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  private getHtmlContent(): string {
    const author = this.pin.author_user_info?.user_name || '匿名';
    const job = this.pin.author_user_info?.job_title || '';
    const avatar = this.pin.author_user_info?.avatar_large || '';
    const content = this.pin.msg_Info?.content || '无内容';
    const picList = this.pin.msg_Info?.pic_list || [];
    const commentCount = this.pin.msg_Info?.comment_count || 0;
    const likeCount = this.pin.msg_Info?.digg_count || 0;

    const commentsHtml = this.comments
      .map((comment) => {
        const ca = comment.user_info?.user_name || '匿名';
        const cc = comment.comment_info?.comment_content || '';
        const cd = comment.comment_info?.digg_count || 0;
        const cAvatar = comment.user_info?.avatar_large || '';
        const pics = comment.comment_info?.comment_pics || [];
        const replies = comment.reply_infos || [];

        const repliesHtml = replies
          .map((reply) => {
            const ra = reply.user_info?.user_name || '匿名';
            const rc = reply.reply_info?.reply_content || '';
            const rd = reply.reply_info?.digg_count || 0;
            const rt = reply.reply_user?.user_name || '';
            const rAvatar = reply.user_info?.avatar_large || '';
            return `
              <div class="reply">
                ${rAvatar ? `<img src="${escapeHtml(rAvatar)}" class="reply-avatar" alt="" />` : ''}
                <div class="reply-body">
                  <div class="reply-header">
                    <span class="reply-author">${escapeHtml(ra)}</span>
                    ${rt ? `<span class="reply-to">回复 ${escapeHtml(rt)}</span>` : ''}
                    <span class="reply-like">👍 ${rd}</span>
                  </div>
                  <div class="reply-content">${escapeHtml(rc)}</div>
                </div>
              </div>`;
          })
          .join('');

        const picsHtml =
          pics.length > 0
            ? `<div class="comment-pics">${pics
                .map((p) => `<img src="${escapeHtml(p.pic_url)}" class="comment-pic" />`)
                .join('')}</div>`
            : '';

        return `
        <div class="comment">
          <div class="comment-head">
            ${cAvatar ? `<img src="${escapeHtml(cAvatar)}" class="comment-avatar" alt="" />` : '<div class="comment-avatar placeholder"></div>'}
            <div class="comment-author">${escapeHtml(ca)}</div>
            <span class="comment-likes">👍 ${cd}</span>
          </div>
          <div class="comment-content">${escapeHtml(cc)}</div>
          ${picsHtml}
          ${repliesHtml ? `<div class="replies">${repliesHtml}</div>` : ''}
        </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>沸点详情</title>
  <style>
    :root {
      --border: var(--vscode-widget-border, #ddd);
      --muted: var(--vscode-descriptionForeground, #999);
      --card-bg: var(--vscode-editorWidget-background, #ffffff);
      --accent: var(--vscode-textLink-foreground, #1a73e8);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.5;
      padding: 12px;
      font-size: 13px;
    }

    /* 头部卡片 */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .author {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .author-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--vscode-button-secondaryBackground, #eee);
    }
    .author-name {
      font-weight: 600;
      font-size: 14px;
    }
    .author-job {
      color: var(--muted);
      font-size: 11px;
      margin-top: 1px;
    }
    .content {
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--vscode-editor-foreground);
    }
    .images {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .images img {
      width: 100px;
      height: 100px;
      object-fit: cover;
      border-radius: 6px;
      cursor: zoom-in;
    }
    .stats {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
    }

    /* 评论区 */
    .comments-title {
      font-weight: 600;
      font-size: 14px;
      margin: 4px 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .comment-list { display: flex; flex-direction: column; gap: 10px; }
    .comment {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
    }
    .comment-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .comment-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--v4-button-placeholder, #eee);
      flex-shrink: 0;
    }
    .comment-author {
      font-weight: 600;
      font-size: 13px;
      flex: 1;
    }
    .comment-likes {
      color: var(--muted);
      font-size: 11px;
      flex-shrink: 0;
    }
    .comment-content {
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 6px;
    }
    .comment-pics {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .comment-pic {
      width: 100px;
      height: 100px;
      object-fit: cover;
      border-radius: 4px;
      cursor: zoom-in;
    }

    /* 回复 */
    .replies {
      margin-top: 8px;
      padding: 8px 10px;
      background: var(--vscode-textBlockQuote-background);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .reply {
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .reply-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
      background: #eee;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .reply-body { flex: 1; min-width: 0; }
    .reply-header { display: flex; gap: 6px; align-items: center; font-size: 11px; }
    .reply-header .reply-author { flex: 0 0 auto; }
    .reply-header .reply-to { flex: 1; }
    .reply-author { font-weight: 600; font-size: 12px; }
    .reply-to { color: var(--muted); font-size: 11px; }
    .reply-content { font-size: 12px; margin-top: 1px; word-break: break-word; }
    .reply-like { color: var(--muted); font-size: 11px; flex-shrink: 0; }

    .empty {
      text-align: center;
      color: var(--muted);
      padding: 20px 0;
      font-size: 12px;
    }
    .comments-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 4px 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .comments-head .title { font-weight: 600; font-size: 14px; }
    .sort-bar { display: flex; gap: 4px; }
    .sort-btn {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: none; color: var(--muted);
      border-radius: 4px; cursor: pointer; font-size: 11px;
    }
    .sort-btn.active {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="author">
      <img src="${escapeHtml(avatar)}" class="author-avatar" alt="头像" />
      <div>
        <div class="author-name">${escapeHtml(author)}</div>
        ${job ? `<div class="author-job">${escapeHtml(job)}</div>` : ''}
      </div>
    </div>
    <div class="content">${escapeHtml(content)}</div>
    ${picList.length > 0 ? `<div class="images">${picList.map((url) => `<img src="${escapeHtml(url)}" />`).join('')}</div>` : ''}
    <div class="stats">
      <span>💬 ${commentCount} 评论</span>
      <span>👍 ${likeCount} 赞</span>
    </div>
  </div>

  <div class="comments-head">
    <span class="title">💬 评论 (${commentCount})</span>
    <div class="sort-bar">
      <button class="sort-btn ${this.commentSort === 0 ? 'active' : ''}" data-sort="0">最新</button>
      <button class="sort-btn ${this.commentSort === 1 ? 'active' : ''}" data-sort="1">最热</button>
    </div>
  </div>
  ${this.comments.length > 0
    ? `<div class="comment-list">${commentsHtml}</div>`
    : `<div class="empty">${commentCount > 0 ? '加载中...' : '暂无评论'}</div>`}
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'sortComments', sort: parseInt(btn.dataset.sort) });
      });
    });
  </script>
</body>
</html>`;
  }
}