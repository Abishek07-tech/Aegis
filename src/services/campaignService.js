import { campaignMock } from '../data/mock/campaigns.js'
import { createService } from './serviceFactory.js'
export const campaignService=createService({endpoint:'/api/campaigns',mock:campaignMock,collection:true})
