import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'
import type { ChromeVersion, EdgeVersion } from '../interface/UserAgentUtil'
import type { MicrosoftRewardsBot } from '../index'

// Mendefinisikan interface internal agar lebih rapi dan Type-Safe
interface AppComponents {
    not_a_brand_version: string;
    not_a_brand_major_version: string;
    edge_version: string;
    edge_major_version: string;
    chrome_version: string;
    chrome_major_version: string;
    chrome_reduced_version: string;
}

export class UserAgentManager {
    private static readonly NOT_A_BRAND_VERSION = '99'
    
    // Properti Cache untuk mencegah request API yang berulang/spamming
    private cachedComponents: AppComponents | null = null
    private cacheTimestamp: number = 0
    private readonly CACHE_TTL = 1000 * 60 * 60 // Cache berlaku selama 1 Jam

    constructor(private bot: MicrosoftRewardsBot) {}

    async getUserAgent(isMobile: boolean, preFetchedComponents?: AppComponents) {
        const system = this.getSystemComponents(isMobile)
        // Gunakan pre-fetched data jika ada untuk mencegah redundant call
        const app = preFetchedComponents ?? await this.getAppComponents(isMobile)

        const uaTemplate = isMobile
            ? `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${app.chrome_reduced_version} Mobile Safari/537.36 EdgA/${app.edge_version}`
            : `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${app.chrome_reduced_version} Safari/537.36 Edg/${app.edge_version}`

        const platformVersion = `${isMobile ? Math.floor(Math.random() * 5) + 9 : Math.floor(Math.random() * 15) + 1}.0.0`

        const uaMetadata = {
            isMobile,
            platform: isMobile ? 'Android' : 'Windows',
            fullVersionList: [
                { brand: 'Not/A)Brand', version: app.not_a_brand_version },
                { brand: 'Microsoft Edge', version: app.edge_version },
                { brand: 'Chromium', version: app.chrome_version }
            ],
            brands: [
                { brand: 'Not/A)Brand', version: app.not_a_brand_major_version },
                { brand: 'Microsoft Edge', version: app.edge_major_version },
                { brand: 'Chromium', version: app.chrome_major_version }
            ],
            platformVersion,
            architecture: isMobile ? '' : 'x86',
            bitness: isMobile ? '' : '64',
            model: '' // Anda bisa merandomisasi model Android di sini ke depannya
        }

        return { userAgent: uaTemplate, userAgentMetadata: uaMetadata }
    }

    private async getChromeVersion(isMobile: boolean): Promise<string> {
        try {
            // Menggunakan endpoint resmi, bukan proxy github blob
            const response = await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json', {
                headers: { 'Content-Type': 'application/json' }
            })
            
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)
            
            const data = (await response.json()) as ChromeVersion
            return data.channels.Stable.version
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'USERAGENT-CHROME-VERSION',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    private async getEdgeVersions(isMobile: boolean) {
        try {
            const response = await fetch('https://edgeupdates.microsoft.com/api/products', {
                headers: { 'Content-Type': 'application/json' }
            })
            
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)

            const data = (await response.json()) as EdgeVersion[]
            const stable = data.find(x => x.Product === 'Stable')
            
            if (!stable) throw new Error('Stable Edge version is unavailable')

            return {
                android: stable.Releases.find(x => x.Platform === 'Android')?.ProductVersion,
                windows: stable.Releases.find(x => x.Platform === 'Windows' && x.Architecture === 'x64')?.ProductVersion
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'USERAGENT-EDGE-VERSION',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    private getSystemComponents(mobile: boolean): string {
        if (mobile) {
            const androidVersion = 10 + Math.floor(Math.random() * 5)
            return `Linux; Android ${androidVersion}; K`
        }
        return 'Windows NT 10.0; Win64; x64'
    }

    async getAppComponents(isMobile: boolean): Promise<AppComponents> {
        const now = Date.now()
        // Mengembalikan cache jika usianya belum lebih dari TTL
        if (this.cachedComponents && (now - this.cacheTimestamp < this.CACHE_TTL)) {
            return this.cachedComponents
        }

        // Fetch secara paralel untuk mempercepat waktu respons
        const [versions, chromeVersion] = await Promise.all([
            this.getEdgeVersions(isMobile),
            this.getChromeVersion(isMobile)
        ])

        const edgeVersion = (isMobile ? versions.android : versions.windows) || '129.0.0.0'
        const edgeMajorVersion = edgeVersion.split('.')[0]

        const chromeMajorVersion = chromeVersion.split('.')[0]
        const chromeReducedVersion = `${chromeMajorVersion}.0.0.0`

        // Simpan ke Cache
        this.cachedComponents = {
            not_a_brand_version: `${UserAgentManager.NOT_A_BRAND_VERSION}.0.0.0`,
            not_a_brand_major_version: UserAgentManager.NOT_A_BRAND_VERSION,
            edge_version: edgeVersion,
            edge_major_version: edgeMajorVersion,
            chrome_version: chromeVersion,
            chrome_major_version: chromeMajorVersion,
            chrome_reduced_version: chromeReducedVersion
        }
        this.cacheTimestamp = now

        return this.cachedComponents
    }

    async updateFingerprintUserAgent(
        fingerprint: BrowserFingerprintWithHeaders,
        isMobile: boolean
    ): Promise<BrowserFingerprintWithHeaders> {
        try {
            // Ambil component satu kali saja untuk fungsi ini
            const componentData = await this.getAppComponents(isMobile)
            const userAgentData = await this.getUserAgent(isMobile, componentData)

            // Inject Navigator - menggunakan tipe "any" khusus di bagian ini untuk library pihak ketiga
            const nav = fingerprint.fingerprint.navigator as any
            nav.userAgentData = userAgentData.userAgentMetadata
            nav.userAgent = userAgentData.userAgent
            nav.appVersion = userAgentData.userAgent.replace(`${nav.appCodeName}/`, '')

            // Inject Headers
            fingerprint.headers['user-agent'] = userAgentData.userAgent
            fingerprint.headers['sec-ch-ua'] = 
                `"Microsoft Edge";v="${componentData.edge_major_version}", "Not=A?Brand";v="${componentData.not_a_brand_major_version}", "Chromium";v="${componentData.chrome_major_version}"`
            fingerprint.headers['sec-ch-ua-full-version-list'] = 
                `"Microsoft Edge";v="${componentData.edge_version}", "Not=A?Brand";v="${componentData.not_a_brand_version}", "Chromium";v="${componentData.chrome_version}"`
            
            // Header pendukung ekstra yang biasanya dicek oleh sistem Anti-Bot
            fingerprint.headers['sec-ch-ua-mobile'] = isMobile ? '?1' : '?0'
            fingerprint.headers['sec-ch-ua-platform'] = isMobile ? '"Android"' : '"Windows"'

            return fingerprint
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'USER-AGENT-UPDATE',
                `An error occurred: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }
}
