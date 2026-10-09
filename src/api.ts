const API_BASE = 'https://api.juejin.cn';

export interface Pin {
  msg_id: string;
  msg_Info: {
    content: string;
    comment_count: number;
    digg_count: number;
    ctime: string;
    pic_list: string[];
  };
  author_user_info: {
    user_name: string;
    job_title: string;
    avatar_large: string;
  };
}

export interface Comment {
  comment_id: string;
  user_info: {
    user_name: string;
    avatar_large?: string;
  };
  comment_info: {
    comment_content: string;
    digg_count: number;
    reply_count: number;
    comment_pics: { pic_url: string }[];
  };
  reply_infos: Reply[];
}

export interface Reply {
  user_info: {
    user_name: string;
    avatar_large?: string;
  };
  reply_info: {
    reply_content: string;
    digg_count: number;
  };
  reply_user: {
    user_name: string;
  };
}

export interface PinsResponse {
  err_no: number;
  err_msg: string;
  data: Pin[];
  cursor: string;
  has_more: boolean;
}

export interface CommentsResponse {
  err_no: number;
  err_msg: string;
  data: Comment[];
  cursor: string;
  has_more: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error('Empty response');
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPins(
  sortType: 'new' | 'hot',
  cursor: string,
  limit: number = 10
): Promise<PinsResponse> {
  return postJson<PinsResponse>(`${API_BASE}/recommend_api/v1/short_msg/recommend`, {
    id_type: 4,
    sort_type: sortType === 'new' ? 300 : 200,
    cursor,
    limit,
  });
}

export async function fetchComments(
  msgId: string,
  cursor: string = '0',
  limit: number = 50,
  sort: number = 0
): Promise<CommentsResponse> {
  return postJson<CommentsResponse>(`${API_BASE}/interact_api/v1/comment/list`, {
    cursor,
    limit,
    item_id: msgId,
    item_type: 4,
    sort_type: 200,
    sort,
  });
}

export interface RepliesResponse {
  err_no: number;
  err_msg: string;
  data: Reply[];
  cursor: string;
  has_more: boolean;
}

export async function fetchReplies(
  commentId: string,
  msgId: string,
  cursor: string = '0',
  limit: number = 50
): Promise<RepliesResponse> {
  return postJson<RepliesResponse>(`${API_BASE}/interact_api/v1/reply/list`, {
    cursor,
    limit,
    comment_id: commentId,
    item_id: msgId,
    item_type: 4,
    sort_type: 200,
  });
}