import vsom = require('vso-node-api/VsoClient');
import { BuildApi } from 'vso-node-api/BuildApi';
import { Build, TypeInfo } from 'vso-node-api/interfaces/BuildInterfaces';
import * as restm from 'typed-rest-client/RestClient';

declare module 'vso-node-api/BuildApi' {
  interface IBuildApi {
    requeueBuild(build: Build, buildId: number, project?: string): Promise<Build>
  }

  interface BuildApi {
    requeueBuild(build: Build, buildId: number, project?: string): Promise<Build>
  }
}
 
BuildApi.prototype.requeueBuild = function(build: Build, buildId: number, project?: string): Promise<Build> {
  return new Promise<Build>(async(resolve, reject) => {
    var routeValues: any = {
      project: project
    };
 
    let queryValues: any = {
      sourceBuildId: buildId
    }
 
    try {
      var verData: vsom.ClientVersioningData = await this.vsoClient.getVersioningData(
        "5.0-preview.4",
        "build",
        "0cd358e1-9217-4d94-8269-1c1ee6f93dcf",
        routeValues,
        queryValues)
 
      var url: string = verData.requestUrl!
      var options: restm.IRequestOptions = this.createRequestOptions(
        'application/json',
        verData.apiVersion)
 
      var res: restm.IRestResponse<Build>
      res = await this.rest.create<Build>(url, { }, options)
 
      var ret = this.formatResponse(res.result, TypeInfo.Build, false)
 
      resolve(ret)
    }
    catch (err) {
      reject(err)
    }
  })
}