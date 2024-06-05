export interface BannerConfig {
    text?: string
    cta?: {
        text?: string
        url?: string
        external?: boolean
    }
    permanent?: boolean
}

export interface RemoteTemplates {
    templates?: {
        code?: string
        featureType?: string
        name?: string
    }[]
}

export interface MultiBannerConfig {
  configs: BannerConfig[]
}

export function getBannerConfig({
    env,
    pathname
}: {
    env: string
    pathname: string
}): BannerConfig {
    if (pathname === '/login' && env === 'development') {
        return {
            cta: {
                external: true,
                text: 'Learn more',
                url: 'https://www.lekko.com/'
            },
            text: 'This is a development only example of a banner on the login page'
        }
    } else if (pathname === '/teams/lekko-staging/repositories/lekkodev/plugins/branches/main') {
        return {
            cta: {
                external: true,
                text: 'Learn more',
                url: 'https://www.lekko.com/'
            },
            text: 'A test banner for a particular repo main page'
        }
    }
    return {}
}
