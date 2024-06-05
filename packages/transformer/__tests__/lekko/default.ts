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
