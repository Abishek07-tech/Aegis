import { applicationMock } from '../data/mock/applications.js'
import { createService } from './serviceFactory.js'
import { getAegisApplications } from './aegisAdapter.js'
export const applicationService=createService({endpoint:'/api/applications',mock:applicationMock,collection:true,api:{list:getAegisApplications}})
