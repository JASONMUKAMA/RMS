FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY backend/RMS.Api/RMS.Api.csproj backend/RMS.Api/
RUN dotnet restore backend/RMS.Api/RMS.Api.csproj
COPY backend/RMS.Api/*.cs backend/RMS.Api/
RUN dotnet publish backend/RMS.Api/RMS.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/RMS.Api/models ./models
COPY --from=api /app/publish .
COPY --from=frontend /src/frontend/dist ./wwwroot
USER app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "RMS.Api.dll"]
