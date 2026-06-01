/**
 * 讯飞星火 API WebSocket 适配层
 *
 * 讯飞使用 WebSocket 而非标准 HTTP，此适配层将其封装为与 OpenAI 兼容的接口
 * API 文档: https://spark-api.xf-yun.com/
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Use native Node.js WebSocket when available, or fallback to bare global type
type WS = InstanceType<typeof WebSocket>;

export interface XunfeiConfig {
  appId: string;
  apiKey: string;
  apiSecret: string;
  version?: 'v1.1' | 'v2' | 'v3.5'; // 默认 v3.5（最新）
}

export interface XunfeiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface XunfeiResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * 讯飞星火 WebSocket 客户端
 */
export class XunfeiClient extends EventEmitter {
  private config: XunfeiConfig;
  private ws?: WebSocket;
  private apiUrl: string;
  private readonly timeout = 60000; // 60s timeout

  constructor(config: XunfeiConfig) {
    super();
    this.config = {
      version: 'v3.5',
      ...config,
    };

    // 构建 API URL
    switch (this.config.version) {
      case 'v1.1':
        this.apiUrl = 'wss://spark-api.xf-yun.com/v1.1/chat';
        break;
      case 'v2':
        this.apiUrl = 'wss://spark-api.xf-yun.com/v2.1/chat';
        break;
      case 'v3.5':
      default:
        this.apiUrl = 'wss://spark-api.xf-yun.com/v3.5/chat';
    }
  }

  /**
   * 生成讯飞 API 的鉴权 URL
   * 使用 HmacSHA256 签名
   */
  private generateAuthUrl(): string {
    const timestamp = new Date().toISOString();
    const signature = this.buildSignature(timestamp);
    const encodedSignature = Buffer.from(signature).toString('base64');

    return `${this.apiUrl}?authorization=${encodedSignature}&date=${timestamp}&host=spark-api.xf-yun.com`;
  }

  /**
   * 生成 HMAC-SHA256 签名
   */
  private buildSignature(timestamp: string): string {
    const host = 'spark-api.xf-yun.com';
    const date = timestamp;
    const requestLine = `GET /v3.5/chat HTTP/1.1`;
    const headerStr = `host: ${host}\ndate: ${date}\nGET /v3.5/chat HTTP/1.1`;

    const hash = crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(headerStr)
      .digest('base64');

    return `api_key="${this.config.appId}", algorithm="hmac-sha256", headers="host date request-line", signature="${hash}"`;
  }

  /**
   * 发起聊天请求
   */
  async chat(messages: XunfeiMessage[], options?: {
    temperature?: number;
    maxTokens?: number;
    onChunk?: (chunk: string) => void;
  }): Promise<XunfeiResponse> {
    return new Promise((resolve, reject) => {
      try {
        const authUrl = this.generateAuthUrl();
        // WebSocket is available in Node.js 18+ and modern runtimes
        const ws: any = new WebSocket(authUrl);
        this.ws = ws;

        let fullContent = '';
        let tokenUsage = { inputTokens: 0, outputTokens: 0 };

        ws.on('open', () => {
          // 发送请求
          const request = {
            header: {
              app_id: this.config.appId,
              uid: `axiom-${Date.now()}`,
            },
            parameter: {
              chat: {
                domain: this.config.version === 'v1.1' ? 'general' : 'generalv2',
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? 4096,
              },
            },
            payload: {
              message: {
                text: messages.map(m => ({
                  role: m.role,
                  content: m.content,
                })),
              },
            },
          };

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(request));
          }
        });

        ws.on('message', (data: string) => {
          try {
            const response = JSON.parse(data);

            // 检查响应状态
            if (response.header?.code !== 0) {
              throw new Error(`讯飞 API 错误: ${response.header?.msg || '未知错误'}`);
            }

            // 提取内容
            const choices = response.payload?.choices?.text || [];
            for (const choice of choices) {
              if (choice.content) {
                fullContent += choice.content;
                if (options?.onChunk) {
                  options.onChunk(choice.content);
                }
              }
            }

            // 检查是否完成（status 为 2）
            if (response.header?.status === 2) {
              tokenUsage = {
                inputTokens: response.payload?.usage?.text?.prompt_tokens || 0,
                outputTokens: response.payload?.usage?.text?.completion_tokens || 0,
              };

              ws.close();

              resolve({
                success: true,
                content: fullContent,
                usage: tokenUsage,
              });
            }
          } catch (error) {
            ws.close();
            reject(error);
          }
        });

        ws.on('error', (error: any) => {
          console.error('[XunfeiClient] WebSocket error:', error);
          reject(new Error(`讯飞 API 连接错误: ${error}`));
        });

        ws.on('close', () => {
          // 连接关闭
        });

        // 设置超时
        setTimeout(() => {
          if ((this.ws as any)?.readyState === WebSocket.OPEN) {
            (this.ws as any)?.close();
          }
          reject(new Error('讯飞 API 请求超时'));
        }, this.timeout);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 关闭连接
   */
  close(): void {
    const w = this.ws as any;
    if (w && w.readyState === WebSocket.OPEN) {
      w.close();
    }
  }
}

/**
 * 转换为 OpenAI 兼容的格式
 */
export async function callXunfeiAPI(
  config: XunfeiConfig,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    onChunk?: (chunk: string) => void;
  }
): Promise<string> {
  const client = new XunfeiClient(config);

  try {
    const xunfeiMessages = messages
      .filter(m => m.role !== 'system') // 讯飞不需要 system 消息，融合到 context
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await client.chat(xunfeiMessages, options);

    if (!response.success || !response.content) {
      throw new Error(`讯飞 API 返回失败: ${response.error || '未知错误'}`);
    }

    return response.content;
  } finally {
    client.close();
  }
}
