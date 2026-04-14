const axios = require('axios');


const prisma = require('../utils/prisma');

const META_BASE_URL = process.env.META_BASE_URL || 'https://graph.facebook.com';
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

/**
 * EMBEDDED SIGNUP - Fluxo OAuth 2.0 da Meta
 *
 * 1. Frontend abre o popup do Facebook com a URL gerada aqui
 * 2. Usuário faz login e concede permissões
 * 3. Meta redireciona para META_REDIRECT_URI com ?code=...
 * 4. Backend troca o code por um access_token
 * 5. Backend busca o WABA e número de telefone vinculados
 * 6. Salva tudo no banco e retorna ao frontend
 */

// ─── Step 1: Gerar URL de autorização ────────────────────────────────────────

const getAuthUrl = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    scope: [
      'whatsapp_business_management',
      'whatsapp_business_messaging',
      'business_management',
    ].join(','),
    response_type: 'code',
    state: req.user.id, // passamos o userId como state para segurança
  });

  const authUrl = `https://www.facebook.com/dialog/oauth?${params.toString()}`;

  return res.json({ success: true, data: { authUrl } });
};

// ─── Step 2: Callback - trocar code por token ─────────────────────────────────

const handleCallback = async (req, res) => {
  try {
    const { code, state: userId, error, error_description } = req.query;

    if (error) {
      console.error('[Meta Callback] Erro da Meta:', error, error_description);
      return res.status(400).json({
        success: false,
        message: `Erro no fluxo de autorização: ${error_description || error}`,
      });
    }

    if (!code || !userId) {
      return res.status(400).json({ success: false, message: 'Parâmetros inválidos.' });
    }

    // Verificar que o user existe
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    // Trocar code por access_token
    const tokenResponse = await axios.get(`${META_BASE_URL}/oauth/access_token`, {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: process.env.META_REDIRECT_URI,
        code,
      },
    });

    const shortLivedToken = tokenResponse.data.access_token;

    // Obter token de longa duração (60 dias)
    const longLivedResponse = await axios.get(
      `${META_BASE_URL}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: shortLivedToken,
        },
      }
    );

    const accessToken = longLivedResponse.data.access_token;

    // Buscar WABAs vinculados ao usuário
    const wabasResponse = await axios.get(
      `${META_BASE_URL}/${META_API_VERSION}/me/businesses`,
      { params: { access_token: accessToken, fields: 'id,name,whatsapp_business_accounts' } }
    );

    const businesses = wabasResponse.data.data || [];

    const savedAccounts = [];

    for (const business of businesses) {
      const wabaList = business.whatsapp_business_accounts?.data || [];

      for (const waba of wabaList) {
        // Buscar números de telefone vinculados ao WABA
        const phonesResponse = await axios.get(
          `${META_BASE_URL}/${META_API_VERSION}/${waba.id}/phone_numbers`,
          { params: { access_token: accessToken } }
        );

        const phones = phonesResponse.data.data || [];

        for (const phone of phones) {
          const account = await prisma.wabaAccount.upsert({
            where: { wabaId: waba.id },
            update: {
              accessToken,
              phoneNumberId: phone.id,
              displayName: phone.display_phone_number || phone.verified_name,
              isActive: true,
            },
            create: {
              userId: user.id,
              wabaId: waba.id,
              phoneNumberId: phone.id,
              displayName: phone.display_phone_number || phone.verified_name,
              accessToken,
            },
          });

          savedAccounts.push(account);
        }
      }
    }

    return res.json({
      success: true,
      message: 'Conta WhatsApp Business vinculada com sucesso.',
      data: { accounts: savedAccounts },
    });
  } catch (error) {
    console.error('[Meta Callback] Erro:', error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar autorização da Meta.',
      error: error?.response?.data,
    });
  }
};

// ─── Listar contas WABA do usuário ────────────────────────────────────────────

const listWabaAccounts = async (req, res) => {
  try {
    const accounts = await prisma.wabaAccount.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        wabaId: true,
        phoneNumberId: true,
        displayName: true,
        webhookVerified: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.json({ success: true, data: accounts });
  } catch (error) {
    console.error('[Meta] listWabaAccounts:', error);
    return res.status(500).json({ success: false, message: 'Erro ao listar contas.' });
  }
};

// ─── Desconectar conta WABA ───────────────────────────────────────────────────

const disconnectWabaAccount = async (req, res) => {
  try {
    const { wabaAccountId } = req.params;

    const account = await prisma.wabaAccount.findFirst({
      where: { id: wabaAccountId, userId: req.user.id },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Conta não encontrada.' });
    }

    await prisma.wabaAccount.update({
      where: { id: wabaAccountId },
      data: { isActive: false },
    });

    return res.json({ success: true, message: 'Conta desconectada com sucesso.' });
  } catch (error) {
    console.error('[Meta] disconnectWabaAccount:', error);
    return res.status(500).json({ success: false, message: 'Erro ao desconectar conta.' });
  }
};

module.exports = { getAuthUrl, handleCallback, listWabaAccounts, disconnectWabaAccount };
