import { campaignMock } from '../data/mock/campaigns.js'
import { createService } from './serviceFactory.js'
import { getAegisCampaigns } from './aegisAdapter.js'
export const campaignService=createService({endpoint:'/api/campaigns',mock:campaignMock,collection:true,api:{list:getAegisCampaigns}})
