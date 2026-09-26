/**
 * 官方账号登录（Z.ai / BigModel OAuth、Coding Plan）总开关。
 *
 * 本分支只保留 API Key / 自定义供应商接入。UI 登录入口与 services 层 OAuth provider
 * 的默认启用状态都读取这里，避免两处开关各自漂移。详见 specs/account-login-disabled.md。
 */
export const ACCOUNT_LOGIN_ENABLED: boolean = false;
