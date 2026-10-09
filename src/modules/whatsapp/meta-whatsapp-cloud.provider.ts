import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class MetaClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: number | undefined,
    public readonly errorSubcode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MetaClientError';
  }
}

export class MetaAmbiguousError extends Error {
  constructor(
    public readonly originalError: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'MetaAmbiguousError';
  }
}

export interface AvailablePhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
}

export interface ResolvedMetaAccountDetails {
  accessToken: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  availablePhoneNumbers: AvailablePhoneNumber[];
}

export interface PhoneNumberDetails {
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
}

export interface SendMessageResult {
  messageId: string; // Canonical Meta wamid
}

@Injectable()
export class MetaWhatsAppCloudProvider {
  private readonly logger = new Logger(MetaWhatsAppCloudProvider.name);
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly requestTimeoutMs = 15000;

  constructor(private readonly configService: ConfigService) {
    this.apiVersion =
      this.configService.get<string>('META_API_VERSION') || 'v21.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    this.appId = this.configService.get<string>('META_APP_ID') || '';
    this.appSecret = this.configService.get<string>('META_APP_SECRET') || '';
  }

  /**
   * Exchanges an Embedded Signup code for a long-lived access token.
   */
  async exchangeCodeForToken(code: string, redirectUri?: string): Promise<string> {
    const defaultRedirectUri =
      redirectUri ||
      this.configService.get<string>('META_REDIRECT_URI') ||
      'https://curtly-repaint-proofs.ngrok-free.dev/api/v1/whatsapp/oauth/callback';

    const urlWithRedirect = `${this.baseUrl}/oauth/access_token?client_id=${encodeURIComponent(
      this.appId,
    )}&client_secret=${encodeURIComponent(this.appSecret)}&code=${encodeURIComponent(
      code,
    )}&redirect_uri=${encodeURIComponent(defaultRedirectUri)}`;

    const urlWithoutRedirect = `${this.baseUrl}/oauth/access_token?client_id=${encodeURIComponent(
      this.appId,
    )}&client_secret=${encodeURIComponent(this.appSecret)}&code=${encodeURIComponent(code)}`;

    try {
      // First attempt with redirect_uri (required by Meta when code is obtained via OAuth dialog)
      let response = await this.executeFetch(urlWithRedirect, { method: 'GET' });
      let data = await response.json();

      // If failed due to redirect_uri mismatch or not expected, fallback without redirect_uri
      if (!response.ok && data?.error?.code === 100 && !data?.access_token) {
        this.logger.warn(
          `Initial token exchange with redirect_uri failed (${data?.error?.message}), falling back without redirect_uri`,
        );
        const fallbackResponse = await this.executeFetch(urlWithoutRedirect, {
          method: 'GET',
        });
        const fallbackData = await fallbackResponse.json();
        if (fallbackResponse.ok && fallbackData.access_token) {
          response = fallbackResponse;
          data = fallbackData;
        }
      }

      if (!response.ok || !data.access_token) {
        throw new MetaClientError(
          response.status,
          data?.error?.code,
          data?.error?.error_subcode,
          data?.error?.message ||
            'Failed to exchange authorization code for access token',
        );
      }

      return data.access_token as string;
    } catch (err: any) {
      if (err instanceof MetaClientError || err instanceof MetaAmbiguousError) {
        throw err;
      }
      throw new MetaAmbiguousError(
        err,
        `Error during code exchange: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves phone number details (display number, verified name, quality rating).
   */
  async getPhoneNumberDetails(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<PhoneNumberDetails> {
    const url = `${this.baseUrl}/${encodeURIComponent(
      phoneNumberId,
    )}?fields=display_phone_number,verified_name,quality_rating`;

    const response = await this.executeFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      this.handleHttpError(response.status, data);
    }

    return {
      display_phone_number: data.display_phone_number || '',
      verified_name: data.verified_name,
      quality_rating: data.quality_rating,
    };
  }

  /**
   * Subscribes application webhooks to the WABA.
   */
  async subscribeWabaApps(
    wabaId: string,
    accessToken: string,
  ): Promise<boolean> {
    const url = `${this.baseUrl}/${encodeURIComponent(wabaId)}/subscribed_apps`;

    const response = await this.executeFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      this.handleHttpError(response.status, data);
    }

    return Boolean(data.success);
  }

  /**
   * Unsubscribes application webhooks from the WABA.
   */
  async unsubscribeWabaApps(
    wabaId: string,
    accessToken: string,
  ): Promise<boolean> {
    const url = `${this.baseUrl}/${encodeURIComponent(wabaId)}/subscribed_apps`;

    const response = await this.executeFetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      this.handleHttpError(response.status, data);
    }

    return Boolean(data.success);
  }

  /**
   * Sends an outbound text message within 24-hour service window.
   */
  async sendTextMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    text: string,
  ): Promise<SendMessageResult> {
    const url = `${this.baseUrl}/${encodeURIComponent(phoneNumberId)}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    let response: Response;
    try {
      response = await this.executeFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      // Socket error, DNS failure, ECONNRESET, timeout
      this.logger.error(
        `Network or timeout error during WhatsApp dispatch to ${to}: ${err.message}`,
      );
      throw new MetaAmbiguousError(
        err,
        `Ambiguous transport error: ${err.message}`,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch (err: any) {
      // 5xx with HTML/empty response, or crash while receiving body
      this.logger.error(
        `Failed to parse Meta API response (Status ${response.status}): ${err.message}`,
      );
      throw new MetaAmbiguousError(
        err,
        `Ambiguous payload parsing error (Status ${response.status})`,
      );
    }

    if (!response.ok) {
      this.handleHttpError(response.status, data);
    }

    const messageId = data?.messages?.[0]?.id;
    if (!messageId || typeof messageId !== 'string') {
      throw new MetaAmbiguousError(
        data,
        'Meta API returned 200 OK but response is missing messages[0].id (canonical wamid)',
      );
    }

    return { messageId };
  }

  
  /**
   * Resolves WABA ID and Phone Number ID from an access token
   * via debug_token and Graph API business endpoints.
   */
  async resolveWabaAndPhoneNumbers(
    accessToken: string,
  ): Promise<ResolvedMetaAccountDetails> {
    let wabaId: string | undefined;

    // 1. Inspect token via debug_token with App Secret proof or App Token
    try {
      const appToken = `${this.appId}|${this.appSecret}`;
      const debugUrl = `${this.baseUrl}/debug_token?input_token=${encodeURIComponent(
        accessToken,
      )}&access_token=${encodeURIComponent(appToken)}`;

      const debugRes = await this.executeFetch(debugUrl, { method: 'GET' });
      const debugData = await debugRes.json();

      if (debugRes.ok && debugData?.data?.granular_scopes) {
        for (const scopeItem of debugData.data.granular_scopes) {
          if (
            (scopeItem.scope === 'whatsapp_business_management' ||
              scopeItem.scope === 'whatsapp_business_messaging') &&
            Array.isArray(scopeItem.target_ids) &&
            scopeItem.target_ids.length > 0
          ) {
            wabaId = String(scopeItem.target_ids[0]);
            this.logger.log(`Resolved WABA ID from granular_scopes: ${wabaId}`);
            break;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`debug_token attempt failed: ${err.message}`);
    }

    // 2. Fallback: Query /me/whatsapp_business_accounts
    if (!wabaId) {
      try {
        const meWabaUrl = `${this.baseUrl}/me/whatsapp_business_accounts`;
        const meWabaRes = await this.executeFetch(meWabaUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const meWabaData = await meWabaRes.json();
        if (meWabaRes.ok && Array.isArray(meWabaData?.data) && meWabaData.data.length > 0) {
          wabaId = String(meWabaData.data[0].id);
          this.logger.log(`Resolved WABA ID from me/whatsapp_business_accounts: ${wabaId}`);
        }
      } catch (err: any) {
        this.logger.warn(`me/whatsapp_business_accounts attempt failed: ${err.message}`);
      }
    }

    // 3. Fallback: Query /me/businesses to discover WABA
    if (!wabaId) {
      try {
        const bizUrl = `${this.baseUrl}/me/businesses?fields=id,name,owned_whatsapp_business_accounts,client_whatsapp_business_accounts`;
        const bizRes = await this.executeFetch(bizUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bizData = await bizRes.json();
        if (bizRes.ok && Array.isArray(bizData?.data)) {
          for (const biz of bizData.data) {
            const owned = biz.owned_whatsapp_business_accounts?.data;
            if (Array.isArray(owned) && owned.length > 0) {
              wabaId = String(owned[0].id);
              break;
            }
            const client = biz.client_whatsapp_business_accounts?.data;
            if (Array.isArray(client) && client.length > 0) {
              wabaId = String(client[0].id);
              break;
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`me/businesses discovery attempt failed: ${err.message}`);
      }
    }

    const availablePhoneNumbers: AvailablePhoneNumber[] = [];
    let phoneNumberId: string | undefined;
    let displayPhoneNumber: string | undefined;
    let verifiedName: string | undefined;
    let qualityRating: string | undefined;

    // If WABA ID found, query its registered phone numbers
    if (wabaId) {
      try {
        const phoneUrl = `${this.baseUrl}/${encodeURIComponent(
          wabaId,
        )}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`;
        const phoneRes = await this.executeFetch(phoneUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const phoneData = await phoneRes.json();
        if (phoneRes.ok && Array.isArray(phoneData?.data)) {
          for (const item of phoneData.data) {
            availablePhoneNumbers.push({
              id: String(item.id),
              display_phone_number: String(item.display_phone_number || ''),
              verified_name: item.verified_name || undefined,
              quality_rating: item.quality_rating || undefined,
            });
          }
          if (availablePhoneNumbers.length > 0) {
            const primary = availablePhoneNumbers[0];
            phoneNumberId = primary.id;
            displayPhoneNumber = primary.display_phone_number;
            verifiedName = primary.verified_name;
            qualityRating = primary.quality_rating;
            this.logger.log(`Resolved primary Phone Number ID: ${phoneNumberId} (${displayPhoneNumber})`);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Error querying phone numbers for WABA ${wabaId}: ${err.message}`);
      }
    }

    return {
      accessToken,
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      verifiedName,
      qualityRating,
      availablePhoneNumbers,
    };
  }

  private async executeFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private handleHttpError(statusCode: number, data: any): never {
    const errorObj = data?.error;
    const errorCode = errorObj?.code;
    const errorSubcode = errorObj?.error_subcode;
    const message = errorObj?.message || `Meta API HTTP error ${statusCode}`;

    if (statusCode >= 400 && statusCode < 500) {
      // Definitive 4xx client/authorization error
      throw new MetaClientError(statusCode, errorCode, errorSubcode, message);
    }

    // 500, 502, 503, 504 are indeterminate server outcomes
    throw new MetaAmbiguousError(
      data,
      `Meta API server error (HTTP ${statusCode}): ${message}`,
    );
  }
}
